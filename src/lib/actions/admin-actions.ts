"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSessionUser, type SessionUser } from "@/lib/auth-helpers";
import { getSettings, getBusinessHours, getBlackoutDateSet, ACTIVE_STATUSES } from "@/lib/booking-data";
import { isValidBookingRange } from "@/lib/scheduling";

export type ActionState = { error?: string; ok?: boolean };

const MAX_BOOKING_HOURS = 6;
const RESCHEDULABLE_STATUSES = ["pending_payment", "awaiting_confirmation", "awaiting_call", "confirmed"];
/** How long a customer has to resubmit a corrected reference number after
 *  the admin flags one as invalid, before the hold auto-cancels. */
const REFERENCE_CORRECTION_MINUTES = 30;

async function requireAdminOrThrow(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/signin");
  if (user.role !== "admin") throw new Error("Forbidden: admin access required.");
  return user;
}

function revalidateBookingViews(bookingId?: string) {
  revalidatePath("/admin");
  revalidatePath("/admin/bookings");
  if (bookingId) revalidatePath(`/book/${bookingId}`);
}

// ---- Booking moderation --------------------------------------------------

export async function verifyBooking(bookingId: string): Promise<ActionState> {
  const admin = await requireAdminOrThrow();
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking || booking.status !== "awaiting_confirmation") {
    return { error: "Only bookings awaiting confirmation can be verified." };
  }
  // payMethod was already recorded when the customer submitted their reference number.
  await prisma.booking.update({ where: { id: bookingId }, data: { status: "confirmed" } });
  await prisma.payment.update({
    where: { bookingId },
    data: { status: "verified", verifiedAt: new Date(), verifiedById: admin.id },
  });
  revalidateBookingViews(bookingId);
  return { ok: true };
}

export async function rejectBooking(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdminOrThrow();
  const bookingId = String(formData.get("bookingId") ?? "");
  const reason = String(formData.get("reason") ?? "").slice(0, 500);
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking || booking.status !== "awaiting_confirmation") {
    return { error: "Only bookings awaiting confirmation can be rejected." };
  }
  // Invalid reference number: give the customer a correction window to
  // resubmit instead of auto-confirming or cancelling outright. Reusing
  // pending_payment lets the existing submitPayment flow accept the
  // resubmission; reapExpiredBookings cancels it if the window lapses.
  const expiresAt = new Date(Date.now() + REFERENCE_CORRECTION_MINUTES * 60_000);
  await prisma.booking.update({ where: { id: bookingId }, data: { status: "pending_payment", expiresAt } });
  await prisma.payment.update({ where: { bookingId }, data: { status: "rejected", rejectReason: reason } });
  revalidateBookingViews(bookingId);
  return { ok: true };
}

export async function confirmCallBooking(bookingId: string): Promise<ActionState> {
  await requireAdminOrThrow();
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking || booking.status !== "awaiting_call") {
    return { error: "Only bookings awaiting a call can be confirmed this way." };
  }
  await prisma.booking.update({ where: { id: bookingId }, data: { status: "confirmed", payMethod: "arranged" } });
  revalidateBookingViews(bookingId);
  return { ok: true };
}

export async function adminCancelBooking(bookingId: string): Promise<ActionState> {
  await requireAdminOrThrow();
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return { error: "Booking not found." };
  await prisma.booking.update({ where: { id: bookingId }, data: { status: "cancelled" } });
  revalidateBookingViews(bookingId);
  return { ok: true };
}

const DELETE_ELIGIBLE_STATUSES = ["cancelled", "expired"];
const DELETE_AFTER_DAYS = 30;

/** Permanently removes a booking, but only once it's been cancelled/expired
 *  for DELETE_AFTER_DAYS — keeps recent history around while letting old
 *  dead records be cleared out instead of accumulating forever. */
export async function adminDeleteBooking(bookingId: string): Promise<ActionState> {
  await requireAdminOrThrow();
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return { error: "Booking not found." };
  if (!DELETE_ELIGIBLE_STATUSES.includes(booking.status)) {
    return { error: "Only cancelled or expired bookings can be deleted." };
  }
  const eligibleSinceMs = Date.now() - DELETE_AFTER_DAYS * 24 * 60 * 60 * 1000;
  if (booking.updatedAt.getTime() > eligibleSinceMs) {
    return { error: `This booking must be cancelled or expired for ${DELETE_AFTER_DAYS} days before it can be deleted.` };
  }
  await prisma.$transaction([
    prisma.payment.deleteMany({ where: { bookingId } }),
    prisma.booking.delete({ where: { id: bookingId } }),
  ]);
  revalidateBookingViews(bookingId);
  return { ok: true };
}

/** Moves a booking to a different court/time/duration, reusing the same open-hours,
 *  blackout, lead-time and double-booking checks the customer-facing flow uses. */
export async function rescheduleBooking(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdminOrThrow();

  const bookingId = String(formData.get("bookingId") ?? "");
  const courtId = Number(formData.get("courtId"));
  const startMs = Number(formData.get("startMs"));
  const hours = Number(formData.get("hours"));

  if (!Number.isFinite(courtId) || !Number.isFinite(startMs)) {
    return { error: "Pick a court and a time slot first." };
  }
  if (!Number.isInteger(hours) || hours < 1 || hours > MAX_BOOKING_HOURS) {
    return { error: "Choose a valid number of hours." };
  }

  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return { error: "Booking not found." };
  if (!RESCHEDULABLE_STATUSES.includes(booking.status)) {
    return { error: "This booking can no longer be rescheduled." };
  }

  const settings = await getSettings();
  const hoursRows = await getBusinessHours();
  const blackouts = await getBlackoutDateSet();

  const range = isValidBookingRange({
    tz: settings.timezone,
    slotDurationMin: settings.slotDurationMin,
    leadMinutes: settings.leadMinutes,
    hours: hoursRows,
    blackouts,
    startMs,
    durationHours: hours,
    now: new Date(),
  });
  if (!range) return { error: "That time is not a valid open slot. Please pick another." };

  const conflict = await prisma.booking.findFirst({
    where: {
      id: { not: bookingId },
      courtId,
      status: { in: [...ACTIVE_STATUSES] },
      startUtc: { lt: range.end },
      endUtc: { gt: range.start },
    },
    select: { id: true },
  });
  if (conflict) return { error: "That slot is already booked. Please pick another time." };

  await prisma.booking.update({
    where: { id: bookingId },
    data: { courtId, startUtc: range.start, endUtc: range.end, hours },
  });
  revalidateBookingViews(bookingId);
  revalidatePath("/my-bookings");
  return { ok: true };
}

// ---- Settings -------------------------------------------------------------

export async function updateSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdminOrThrow();

  const businessName = String(formData.get("businessName") ?? "").trim();
  const contactPerson = String(formData.get("contactPerson") ?? "").trim();
  const contactPhone = String(formData.get("contactPhone") ?? "").trim();
  const contactEmail = String(formData.get("contactEmail") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const priceInput = Number(formData.get("price"));
  const currency = String(formData.get("currency") ?? "PHP").trim().toUpperCase();
  const timezone = String(formData.get("timezone") ?? "Asia/Manila").trim();
  const gcashName = String(formData.get("gcashName") ?? "").trim();
  const gcashNumber = String(formData.get("gcashNumber") ?? "").trim();
  const bdoAccountName = String(formData.get("bdoAccountName") ?? "").trim();
  const bdoAccountNumber = String(formData.get("bdoAccountNumber") ?? "").trim();
  const qrphAccountName = String(formData.get("qrphAccountName") ?? "").trim();
  const qrphAccountNumber = String(formData.get("qrphAccountNumber") ?? "").trim();
  const holdMinutes = Number(formData.get("holdMinutes"));
  const leadMinutes = Number(formData.get("leadMinutes"));

  if (!businessName) return { error: "Business name is required." };
  if (!Number.isFinite(priceInput) || priceInput <= 0) return { error: "Enter a valid price per hour." };
  if (!Number.isFinite(holdMinutes) || holdMinutes <= 0) return { error: "Enter a valid hold time (minutes)." };
  if (!Number.isFinite(leadMinutes) || leadMinutes < 0) return { error: "Enter a valid lead time (minutes)." };
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: timezone });
  } catch {
    return { error: "Invalid timezone — use an IANA name like Asia/Manila." };
  }

  await prisma.setting.update({
    where: { id: 1 },
    data: {
      businessName,
      contactPerson,
      contactPhone,
      contactEmail,
      address,
      priceCentsPerHour: Math.round(priceInput * 100),
      currency,
      timezone,
      gcashName,
      gcashNumber,
      bdoAccountName,
      bdoAccountNumber,
      qrphAccountName,
      qrphAccountNumber,
      holdMinutes: Math.round(holdMinutes),
      leadMinutes: Math.round(leadMinutes),
    },
  });
  revalidatePath("/admin/settings");
  revalidatePath("/");
  revalidatePath("/book");
  return { ok: true };
}

// ---- Courts -----------------------------------------------------------------

export async function addCourt(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdminOrThrow();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Court name is required." };
  const count = await prisma.court.count();
  await prisma.court.create({ data: { name, sortOrder: count + 1 } });
  revalidatePath("/admin/courts");
  revalidatePath("/book");
  return { ok: true };
}

export async function toggleCourt(courtId: number): Promise<ActionState> {
  await requireAdminOrThrow();
  const court = await prisma.court.findUnique({ where: { id: courtId } });
  if (!court) return { error: "Court not found." };
  await prisma.court.update({ where: { id: courtId }, data: { active: !court.active } });
  revalidatePath("/admin/courts");
  revalidatePath("/book");
  return { ok: true };
}

export async function renameCourt(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdminOrThrow();
  const courtId = Number(formData.get("courtId"));
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Court name is required." };
  await prisma.court.update({ where: { id: courtId }, data: { name } });
  revalidatePath("/admin/courts");
  revalidatePath("/book");
  return { ok: true };
}

// ---- Business hours -----------------------------------------------------

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

export async function updateBusinessHours(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdminOrThrow();

  const rows: { weekday: number; openMin: number; closeMin: number }[] = [];
  for (let d = 0; d < 7; d++) {
    const closed = formData.get(`closed-${d}`) === "on";
    if (closed) {
      rows.push({ weekday: d, openMin: 0, closeMin: 0 });
      continue;
    }
    const openMin = timeToMinutes(String(formData.get(`open-${d}`) ?? "00:00"));
    const closeRaw = timeToMinutes(String(formData.get(`close-${d}`) ?? "00:00"));
    // A close time of 00:00 means "closes at midnight" (end of day), not
    // "closes at the very start of the day" — use the Closed checkbox for that.
    const closeMin = closeRaw === 0 ? 1440 : closeRaw;
    if (openMin < 0 || openMin > 1440 || closeMin < 0 || closeMin > 1440 || openMin >= closeMin) {
      return { error: `Invalid hours for ${WEEKDAY_NAMES[d]}: open time must be before close time.` };
    }
    rows.push({ weekday: d, openMin, closeMin });
  }

  await prisma.$transaction([
    prisma.businessHour.deleteMany({}),
    prisma.businessHour.createMany({ data: rows.filter((r) => r.closeMin > r.openMin) }),
  ]);
  revalidatePath("/admin/hours");
  revalidatePath("/");
  revalidatePath("/book");
  return { ok: true };
}

// ---- Price tiers ------------------------------------------------------------

export async function updatePriceTiers(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdminOrThrow();

  const count = Number(formData.get("tierCount") ?? 0);
  const rows: { startMin: number; endMin: number; priceCentsPerHour: number }[] = [];
  for (let i = 0; i < count; i++) {
    const startMin = timeToMinutes(String(formData.get(`start-${i}`) ?? "00:00"));
    const endRaw = timeToMinutes(String(formData.get(`end-${i}`) ?? "00:00"));
    // Same "00:00 close means midnight" convention as business hours.
    const endMin = endRaw === 0 ? 1440 : endRaw;
    const priceInput = Number(formData.get(`price-${i}`));
    if (!Number.isFinite(priceInput) || priceInput <= 0) {
      return { error: `Enter a valid rate for tier ${i + 1}.` };
    }
    if (startMin < 0 || startMin > 1440 || endMin < 0 || endMin > 1440 || startMin >= endMin) {
      return { error: `Tier ${i + 1}: start time must be before end time.` };
    }
    rows.push({ startMin, endMin, priceCentsPerHour: Math.round(priceInput * 100) });
  }

  await prisma.$transaction([prisma.priceTier.deleteMany({}), prisma.priceTier.createMany({ data: rows })]);
  revalidatePath("/admin/pricing");
  revalidatePath("/");
  revalidatePath("/book");
  return { ok: true };
}

// ---- Blackout dates -------------------------------------------------------

export async function addBlackout(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdminOrThrow();
  const dateStr = String(formData.get("date") ?? "");
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 255);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return { error: "Pick a valid date." };
  await prisma.blackoutDate.upsert({
    where: { date: new Date(`${dateStr}T00:00:00.000Z`) },
    update: { reason },
    create: { date: new Date(`${dateStr}T00:00:00.000Z`), reason },
  });
  revalidatePath("/admin/blackouts");
  revalidatePath("/");
  revalidatePath("/book");
  return { ok: true };
}

export async function deleteBlackout(dateISO: string): Promise<ActionState> {
  await requireAdminOrThrow();
  await prisma.blackoutDate.delete({ where: { date: new Date(`${dateISO}T00:00:00.000Z`) } });
  revalidatePath("/admin/blackouts");
  revalidatePath("/");
  revalidatePath("/book");
  return { ok: true };
}
