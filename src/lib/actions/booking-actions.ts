"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth-helpers";
import { getSettings, getBusinessHours, getBlackoutDateSet, getBusyIntervals, ACTIVE_STATUSES } from "@/lib/booking-data";
import { isValidBookingRange, isFree } from "@/lib/scheduling";

export type ActionState = { error?: string; ok?: boolean };

const MAX_BOOKING_HOURS = 6;

export async function createBooking(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user) redirect("/api/auth/signin");

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

  const busy = await getBusyIntervals(courtId, range.start, range.end);
  if (!isFree(range.start, range.end, busy)) {
    return { error: "That slot was just taken. Please pick another time." };
  }

  const expiresAt = new Date(now.getTime() + settings.holdMinutes * 60_000);
  const isMultiHour = hours >= 2;

  const booking = await prisma.booking.create({
    data: {
      courtId,
      customerId: user.id,
      startUtc: range.start,
      endUtc: range.end,
      hours,
      status: isMultiHour ? "awaiting_call" : "pending_payment",
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
  if (!user) redirect("/api/auth/signin");

  const bookingId = String(formData.get("bookingId") ?? "");
  const reference = String(formData.get("referenceNumber") ?? "").trim();
  if (!reference) return { error: "Enter the GCash reference number." };

  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking || booking.customerId !== user.id) return { error: "Booking not found." };

  if (booking.expiresAt && booking.expiresAt < new Date() && booking.status === "pending_payment") {
    await prisma.booking.update({ where: { id: booking.id }, data: { status: "expired" } });
    return { error: "This hold has expired. Please book again." };
  }
  if (booking.status !== "pending_payment") {
    return { error: "This booking can no longer accept a reference number." };
  }

  const settings = await getSettings();
  await prisma.payment.upsert({
    where: { bookingId: booking.id },
    update: {
      referenceNumber: reference,
      amountCents: settings.priceCentsPerHour * booking.hours,
      status: "submitted",
      submittedAt: new Date(),
      verifiedById: null,
      verifiedAt: null,
      rejectReason: "",
    },
    create: {
      bookingId: booking.id,
      referenceNumber: reference,
      amountCents: settings.priceCentsPerHour * booking.hours,
      status: "submitted",
    },
  });
  await prisma.booking.update({
    where: { id: booking.id },
    data: { status: "awaiting_confirmation" },
  });

  revalidatePath(`/book/${booking.id}`);
  revalidatePath("/my-bookings");
  return { ok: true };
}

const CANCELLABLE_STATUSES = ["pending_payment", "awaiting_confirmation", "awaiting_call", "confirmed"];

export async function cancelBooking(bookingId: string): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user) redirect("/api/auth/signin");

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
