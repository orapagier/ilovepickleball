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
} from "@/lib/booking-data";
import { isValidBookingRange, isFree, MAX_ADVANCE_DAYS, MAX_BOOKING_HOURS } from "@/lib/scheduling";
import { computeBookingPriceCents } from "@/lib/pricing";

export type ActionState = { error?: string; ok?: boolean };

/** Bookings this long or longer need a phone call to arrange payment instead of an instant reference-number reserve. */
const CALL_REQUIRED_HOURS = 4;
const REFERENCE_PAY_METHODS = ["gcash", "bdo", "qrph"] as const;

export async function createBooking(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user) redirect("/signin?callbackUrl=/book");

  const { complete: profileComplete } = await getProfileCompletion(user.id);
  if (!profileComplete) redirect("/register?callbackUrl=/book");

  const courtId = Number(formData.get("courtId"));
  const startMs = Number(formData.get("startMs"));
  const hours = Number(formData.get("hours"));
  const note = String(formData.get("note") ?? "").slice(0, 500);

  if (!Number.isFinite(courtId) || !Number.isFinite(startMs)) {
    return { error: "Pick a court and a time slot first." };
  }
  if (!Number.isInteger(hours) || hours < 1 || hours > MAX_BOOKING_HOURS) {
    return { error: "Choose a valid number of hours." };
  }

  const settings = await getSettings();
  const hoursRows = await getBusinessHours();
  const blackouts = await getBlackoutDateSet();
  const now = new Date();

  const range = isValidBookingRange({
    tz: settings.timezone,
    slotDurationMin: settings.slotDurationMin,
    leadMinutes: settings.leadMinutes,
    hours: hoursRows,
    blackouts,
    startMs,
    durationHours: hours,
    now,
  });
  if (!range) {
    return { error: "That time is no longer a valid open slot. Please pick another." };
  }

  const maxISO = DateTime.fromJSDate(now, { zone: settings.timezone }).plus({ days: MAX_ADVANCE_DAYS }).toFormat("yyyy-LL-dd");
  const startISO = DateTime.fromJSDate(range.start, { zone: settings.timezone }).toFormat("yyyy-LL-dd");
  if (startISO > maxISO) {
    return { error: `Bookings can only be made up to ${MAX_ADVANCE_DAYS} days in advance.` };
  }

  const busy = await getBusyIntervals(courtId, range.start, range.end);
  if (!isFree(range.start, range.end, busy)) {
    return { error: "That slot was just taken. Please pick another time." };
  }

  const expiresAt = new Date(now.getTime() + settings.holdMinutes * 60_000);
  const requiresCall = hours >= CALL_REQUIRED_HOURS;

  const booking = await prisma.booking.create({
    data: {
      courtId,
      customerId: user.id,
      startUtc: range.start,
      endUtc: range.end,
      hours,
      status: requiresCall ? "awaiting_call" : "pending_payment",
      expiresAt,
      customerNote: note,
    },
  });

  // Race guard: another request may have booked the same court/time between
  // our availability read and this insert.
  const conflict = await prisma.booking.findFirst({
    where: {
      id: { not: booking.id },
      courtId,
      status: { in: [...ACTIVE_STATUSES] },
      startUtc: { lt: range.end },
      endUtc: { gt: range.start },
    },
    select: { id: true },
  });
  if (conflict) {
    await prisma.booking.delete({ where: { id: booking.id } });
    return { error: "That slot was just taken. Please pick another time." };
  }

  revalidatePath("/my-bookings");
  redirect(`/book/${booking.id}`);
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
  const amountCents = computeBookingPriceCents({
    startMs: booking.startUtc.getTime(),
    hours: booking.hours,
    slotDurationMin: settings.slotDurationMin,
    tz: settings.timezone,
    tiers,
    fallbackCentsPerHour: settings.priceCentsPerHour,
  });

  await prisma.payment.upsert({
    where: { bookingId: booking.id },
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
      bookingId: booking.id,
      referenceNumber: reference,
      amountCents,
      status: "submitted",
    },
  });
  await prisma.booking.update({
    where: { id: booking.id },
    data: { status: "awaiting_confirmation", payMethod },
  });

  revalidatePath(`/book/${booking.id}`);
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
  revalidatePath("/my-bookings");
  revalidatePath(`/book/${bookingId}`);
  return { ok: true };
}
