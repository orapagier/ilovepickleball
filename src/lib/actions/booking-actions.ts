"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { DateTime } from "luxon";
import { prisma } from "@/lib/prisma";
import { getSessionUser, getProfileCompletion } from "@/lib/auth-helpers";
import {
  getSettings,
  getBusinessHours,
  getBlackoutDateSet,
  getBusyIntervals,
  getPriceTiers,
  ACTIVE_STATUSES,
  getRestWindows,
} from "@/lib/booking-data";
import {
  isValidBookingRange,
  isFree,
  groupSlotsIntoRuns,
  MAX_ADVANCE_DAYS,
  MAX_BOOKING_HOURS,
  MAX_SELECTED_SLOTS,
  type SlotRun,
} from "@/lib/scheduling";
import { computeBookingPriceCents } from "@/lib/pricing";
import { queueCalendarSync } from "@/lib/google-calendar";
import { resolveGroupAnchorId } from "@/lib/booking-group";

export type ActionState = { error?: string; ok?: boolean };

/** Bookings this long or longer need a phone call to arrange payment instead of an instant reference-number reserve. */
const CALL_REQUIRED_HOURS = 4;
const REFERENCE_PAY_METHODS = ["gcash", "bdo", "qrph"] as const;

/** The grid posts its ticked cells as JSON. Anything malformed is rejected
 *  outright rather than partially honoured — a half-read selection would book
 *  hours the customer never picked. */
function parseSlotPicks(raw: string): { courtId: number; startMs: number }[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const picks: { courtId: number; startMs: number }[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) return null;
    const { courtId, startMs } = item as Record<string, unknown>;
    if (!Number.isInteger(courtId) || !Number.isFinite(startMs)) return null;
    picks.push({ courtId: courtId as number, startMs: startMs as number });
  }
  return picks;
}

export async function createBooking(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user) redirect("/signin?callbackUrl=/book");

  const { complete: profileComplete } = await getProfileCompletion(user.id);
  if (!profileComplete) redirect("/register?callbackUrl=/book");

  const note = String(formData.get("note") ?? "").slice(0, 500);
  const picks = parseSlotPicks(String(formData.get("slots") ?? ""));

  if (!picks) return { error: "That selection could not be read. Please pick your slots again." };
  if (picks.length === 0) return { error: "Pick at least one slot first." };
  if (picks.length > MAX_SELECTED_SLOTS) {
    return { error: `You can book at most ${MAX_SELECTED_SLOTS} slots at a time.` };
  }

  const settings = await getSettings();
  const hoursRows = await getBusinessHours();
  const blackouts = await getBlackoutDateSet();
  const restWindows = await getRestWindows();
  const now = new Date();

  const runs = groupSlotsIntoRuns(picks, settings.slotDurationMin);
  if (runs.some((run) => run.hours > MAX_BOOKING_HOURS)) {
    return { error: `A court can only be booked for ${MAX_BOOKING_HOURS} hours in a row.` };
  }

  const maxISO = DateTime.fromJSDate(now, { zone: settings.timezone }).plus({ days: MAX_ADVANCE_DAYS }).toFormat("yyyy-LL-dd");

  /* Validate the whole selection before creating any of it, so an unbookable
     pick fails the request outright instead of leaving the customer with half
     their evening reserved and half of it gone. */
  const ranges: { run: SlotRun; start: Date; end: Date }[] = [];
  for (const run of runs) {
    const range = isValidBookingRange({
      tz: settings.timezone,
      slotDurationMin: settings.slotDurationMin,
      leadMinutes: settings.leadMinutes,
      hours: hoursRows,
      blackouts,
      rest: restWindows,
      startMs: run.startMs,
      durationHours: run.hours,
      now,
    });
    if (!range) {
      return { error: "One of those times is no longer a valid open slot. Please pick again." };
    }
    const startISO = DateTime.fromJSDate(range.start, { zone: settings.timezone }).toFormat("yyyy-LL-dd");
    if (startISO > maxISO) {
      return { error: `Bookings can only be made up to ${MAX_ADVANCE_DAYS} days in advance.` };
    }
    ranges.push({ run, start: range.start, end: range.end });
  }

  const expiresAt = new Date(now.getTime() + settings.holdMinutes * 60_000);
  const createdIds: string[] = [];

  const failure = await (async (): Promise<string | null> => {
    for (const { run, start, end } of ranges) {
      const busy = await getBusyIntervals(run.courtId, start, end);
      if (!isFree(start, end, busy)) return "One of those slots was just taken. Please pick again.";

      const booking = await prisma.booking.create({
        data: {
          courtId: run.courtId,
          customerId: user.id,
          startUtc: start,
          endUtc: end,
          hours: run.hours,
          status: run.hours >= CALL_REQUIRED_HOURS ? "awaiting_call" : "pending_payment",
          expiresAt,
          customerNote: note,
        },
      });
      createdIds.push(booking.id);

      // Race guard: another request may have booked the same court/time between
      // our availability read and this insert. Our own new rows are excluded —
      // a multi-slot selection legitimately holds several at once.
      const conflict = await prisma.booking.findFirst({
        where: {
          id: { notIn: createdIds },
          courtId: run.courtId,
          status: { in: [...ACTIVE_STATUSES] },
          startUtc: { lt: end },
          endUtc: { gt: start },
        },
        select: { id: true },
      });
      if (conflict) return "One of those slots was just taken. Please pick again.";
    }
    return null;
  })();

  if (failure) {
    // Nothing here has a payment row yet, so the holds can just be dropped.
    if (createdIds.length > 0) await prisma.booking.deleteMany({ where: { id: { in: createdIds } } });
    return { error: failure };
  }

  /* Bookings made in the same submit are tied together under the first one's
     id, so a multi-slot pick pays with one reference number instead of one
     per booking — see submitPayment below and the `groupId` comment on the
     Booking model. The first booking's own groupId stays null; it's the
     anchor other members point at. */
  if (createdIds.length > 1) {
    await prisma.booking.updateMany({
      where: { id: { in: createdIds.slice(1) } },
      data: { groupId: createdIds[0] },
    });
  }

  for (const id of createdIds) queueCalendarSync(id);
  revalidatePath("/my-bookings");

  /* Land on whichever created booking can actually take a payment, so the
     reference-number form is what the customer sees next — not a "call us"
     notice for an unrelated booking that happened to be created first. */
  const landingIdx = ranges.findIndex((r) => r.run.hours < CALL_REQUIRED_HOURS);
  const landingId = landingIdx >= 0 ? createdIds[landingIdx] : createdIds[0];
  redirect(`/book/${landingId}`);
}

export async function submitPayment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user) redirect("/signin");

  const bookingId = String(formData.get("bookingId") ?? "");
  const reference = String(formData.get("referenceNumber") ?? "").trim();
  const payMethodRaw = String(formData.get("payMethod") ?? "");
  if (!reference) return { error: "Enter the reference number." };
  if (!REFERENCE_PAY_METHODS.includes(payMethodRaw as (typeof REFERENCE_PAY_METHODS)[number])) {
    return { error: "Choose a payment method." };
  }
  const payMethod = payMethodRaw as (typeof REFERENCE_PAY_METHODS)[number];

  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking || booking.customerId !== user.id) return { error: "Booking not found." };

  if (booking.expiresAt && booking.expiresAt < new Date() && booking.status === "pending_payment") {
    await prisma.booking.update({ where: { id: booking.id }, data: { status: "expired" } });
    return { error: "This hold has expired. Please book again." };
  }
  if (booking.status !== "pending_payment") {
    return { error: "This booking can no longer accept a reference number." };
  }

  const [settings, tiers] = await Promise.all([getSettings(), getPriceTiers()]);

  /* Whichever booking in the group this form was shown for, the same
     reference number pays for every court/time the customer ticked in that
     checkout — not just this one row. Each still gets its own Payment row
     (so every existing per-booking view, admin queue included, keeps
     working), but all of them share this reference and submit together. */
  const anchorId = resolveGroupAnchorId(booking);
  const groupBookings = await prisma.booking.findMany({
    where: {
      customerId: user.id,
      status: "pending_payment",
      OR: [{ id: anchorId }, { groupId: anchorId }],
    },
  });

  await Promise.all(
    groupBookings.map(async (b) => {
      const amountCents = computeBookingPriceCents({
        startMs: b.startUtc.getTime(),
        hours: b.hours,
        slotDurationMin: settings.slotDurationMin,
        tz: settings.timezone,
        tiers,
        fallbackCentsPerHour: settings.priceCentsPerHour,
      });

      await prisma.payment.upsert({
        where: { bookingId: b.id },
        update: {
          referenceNumber: reference,
          amountCents,
          status: "submitted",
          submittedAt: new Date(),
          verifiedById: null,
          verifiedAt: null,
          rejectReason: "",
        },
        create: {
          bookingId: b.id,
          referenceNumber: reference,
          amountCents,
          status: "submitted",
        },
      });
      await prisma.booking.update({
        where: { id: b.id },
        data: { status: "awaiting_confirmation", payMethod },
      });

      queueCalendarSync(b.id);
      revalidatePath(`/book/${b.id}`);
    }),
  );

  revalidatePath("/my-bookings");
  return { ok: true };
}

const CANCELLABLE_STATUSES = ["pending_payment", "awaiting_confirmation", "awaiting_call", "confirmed"];

export async function cancelBooking(bookingId: string): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user) redirect("/signin");

  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking || booking.customerId !== user.id) return { error: "Booking not found." };
  if (!CANCELLABLE_STATUSES.includes(booking.status)) {
    return { error: "This booking can no longer be cancelled." };
  }

  await prisma.booking.update({ where: { id: bookingId }, data: { status: "cancelled" } });
  queueCalendarSync(bookingId);
  revalidatePath("/my-bookings");
  revalidatePath(`/book/${bookingId}`);
  return { ok: true };
}
