"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSessionUser, type SessionUser } from "@/lib/auth-helpers";
import { getSettings, getBusinessHours, getBlackoutDateSet, ACTIVE_STATUSES } from "@/lib/booking-data";
import { isValidBookingRange, MAX_BOOKING_HOURS } from "@/lib/scheduling";
import { queueCalendarSync, removeCalendarEvent } from "@/lib/google-calendar";

export type ActionState = { error?: string; ok?: boolean };

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
  revalidatePath("/admin/users");
  // Every user detail page, since each lists that customer's bookings and the
  // acting admin may be looking at any of them.
  revalidatePath("/admin/users/[id]", "page");
  // An admin can also act on bookings from /my-bookings, which lists every
  // customer's for them.
  revalidatePath("/my-bookings");
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
  queueCalendarSync(bookingId);
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
  queueCalendarSync(bookingId);
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
  queueCalendarSync(bookingId);
  revalidateBookingViews(bookingId);
  return { ok: true };
}

export async function adminCancelBooking(bookingId: string): Promise<ActionState> {
  await requireAdminOrThrow();
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return { error: "Booking not found." };
  await prisma.booking.update({ where: { id: bookingId }, data: { status: "cancelled" } });
  queueCalendarSync(bookingId);
  revalidateBookingViews(bookingId);
  return { ok: true };
}

/** Permanently removes a booking and the payment record attached to it. Any
 *  status, no waiting period — an admin clearing test data or a duplicate
 *  shouldn't have to cancel and then wait; the confirm dialog is the guard.
 *  Deleting an active booking frees the slot without telling the customer,
 *  so the UI warns before calling this on one. */
export async function adminDeleteBooking(bookingId: string): Promise<ActionState> {
  await requireAdminOrThrow();
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { googleEventId: true, court: { select: { googleCalendarId: true } } },
  });
  if (!booking) return { error: "Booking not found." };
  // Awaited, unlike every other sync: once the row is gone there is nothing
  // left to tell us which event to remove, so it can't be left to a retry.
  await removeCalendarEvent(booking.court.googleCalendarId, booking.googleEventId);
  await prisma.$transaction([
    // Payment's FK to Booking is required, so its row goes first.
    prisma.payment.deleteMany({ where: { bookingId } }),
    prisma.booking.delete({ where: { id: bookingId } }),
  ]);
  revalidateBookingViews(bookingId);
  return { ok: true };
}

// ---- Users ----------------------------------------------------------------

/** Deletes a user along with every booking and payment of theirs. Ends in a
 *  redirect so this works from the user's own detail page, which would
 *  otherwise be left rendering a record that no longer exists. */
export async function adminDeleteUser(userId: string): Promise<ActionState> {
  const admin = await requireAdminOrThrow();
  // Nothing else stops an admin from removing their own access mid-session,
  // and it would take the last admin account with it.
  if (admin.id === userId) return { error: "You cannot delete your own account." };
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) return { error: "User not found." };

  // Same reason as adminDeleteBooking: the event ids die with the rows.
  const mirrored = await prisma.booking.findMany({
    where: { customerId: userId, googleEventId: { not: "" } },
    select: { googleEventId: true, court: { select: { googleCalendarId: true } } },
  });
  for (const b of mirrored) await removeCalendarEvent(b.court.googleCalendarId, b.googleEventId);

  await prisma.$transaction([
    prisma.payment.deleteMany({ where: { booking: { customerId: userId } } }),
    // Payments this user verified as an admin belong to other people's
    // bookings and outlive the account — drop only the attribution.
    prisma.payment.updateMany({ where: { verifiedById: userId }, data: { verifiedById: null } }),
    prisma.booking.deleteMany({ where: { customerId: userId } }),
    prisma.user.delete({ where: { id: userId } }),
  ]);

  revalidateBookingViews();
  redirect("/admin/users");
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

  // Moving courts means moving calendars: drop the old event first and let the
  // sync create a fresh one. A same-court time change just patches in place.
  const movedCourt = courtId !== booking.courtId;
  if (movedCourt) {
    const old = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { googleEventId: true, court: { select: { googleCalendarId: true } } },
    });
    if (old) await removeCalendarEvent(old.court.googleCalendarId, old.googleEventId);
  }
  await prisma.booking.update({
    where: { id: bookingId },
    data: {
      courtId,
      startUtc: range.start,
      endUtc: range.end,
      hours,
      ...(movedCourt ? { googleEventId: "" } : {}),
    },
  });
  queueCalendarSync(bookingId);
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
  const averageMatchMinutes = Number(formData.get("averageMatchMinutes"));
  const courtChangeoverMinutes = Number(formData.get("courtChangeoverMinutes"));

  if (!businessName) return { error: "Business name is required." };
  if (!Number.isFinite(priceInput) || priceInput <= 0) return { error: "Enter a valid price per hour." };
  if (!Number.isFinite(holdMinutes) || holdMinutes <= 0) return { error: "Enter a valid hold time (minutes)." };
  if (!Number.isFinite(leadMinutes) || leadMinutes < 0) return { error: "Enter a valid lead time (minutes)." };
  if (!Number.isFinite(averageMatchMinutes) || averageMatchMinutes < 1) {
    return { error: "Enter how many minutes a tournament match takes." };
  }
  if (!Number.isFinite(courtChangeoverMinutes) || courtChangeoverMinutes < 0) {
    return { error: "Enter a valid court changeover time (minutes)." };
  }
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
      averageMatchMinutes: Math.round(averageMatchMinutes),
      courtChangeoverMinutes: Math.round(courtChangeoverMinutes),
    },
  });
  revalidatePath("/admin/settings");
  revalidatePath("/");
  revalidatePath("/book");
  // Tournament court blocks are sized off these, so their views change too.
  revalidatePath("/admin/tournaments/[id]", "page");
  revalidatePath("/tournaments/[id]", "page");
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

/**
 * Remove a court outright. Only ever allowed for one nothing points at —
 * a court carries its bookings' history, so anything with a booking, past or
 * present, is disabled rather than deleted. This is for tidying up a row that
 * was created by mistake.
 */
export async function deleteCourt(courtId: number): Promise<ActionState> {
  await requireAdminOrThrow();
  const court = await prisma.court.findUnique({
    where: { id: courtId },
    select: {
      name: true,
      _count: { select: { bookings: true, tournamentCourts: true, tournamentMatches: true } },
    },
  });
  if (!court) return { error: "Court not found." };

  if (court._count.bookings > 0) {
    return {
      error: `${court.name} has ${court._count.bookings} booking${court._count.bookings === 1 ? "" : "s"} on record — disable it instead, so their history stays intact.`,
    };
  }
  if (court._count.tournamentCourts > 0 || court._count.tournamentMatches > 0) {
    return { error: `${court.name} is reserved by a tournament — remove it from that tournament first.` };
  }
  if ((await prisma.court.count()) <= 1) {
    return { error: "This is the only court — the booking grid needs at least one." };
  }

  await prisma.court.delete({ where: { id: courtId } });

  // `addCourt` numbers a new court `count + 1`, so the remaining rows are
  // closed up to keep that scheme from handing out a duplicate sortOrder.
  const remaining = await prisma.court.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true } });
  await prisma.$transaction(
    remaining.map((c, i) => prisma.court.update({ where: { id: c.id }, data: { sortOrder: i + 1 } })),
  );

  revalidatePath("/admin/courts");
  revalidatePath("/book");
  return { ok: true };
}

/** Points a court at the Google Calendar its bookings are mirrored into.
 *  Blank unmaps it, which stops the mirror for that court. */
export async function setCourtCalendar(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdminOrThrow();
  const courtId = Number(formData.get("courtId"));
  const googleCalendarId = String(formData.get("googleCalendarId") ?? "").trim();
  // Calendar ids are addresses — either the owner's email or the long
  // ...@group.calendar.google.com form a secondary calendar gets.
  if (googleCalendarId && !googleCalendarId.includes("@")) {
    return { error: "That doesn't look like a calendar ID — copy it from Calendar settings." };
  }
  await prisma.court.update({ where: { id: courtId }, data: { googleCalendarId } });
  revalidatePath("/admin/courts");
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
  const rows: { startMin: number; endMin: number; weekday: number | null; priceCentsPerHour: number }[] = [];
  for (let i = 0; i < count; i++) {
    const startMin = timeToMinutes(String(formData.get(`start-${i}`) ?? "00:00"));
    const endRaw = timeToMinutes(String(formData.get(`end-${i}`) ?? "00:00"));
    // Same "00:00 close means midnight" convention as business hours.
    const endMin = endRaw === 0 ? 1440 : endRaw;
    const priceInput = Number(formData.get(`price-${i}`));
    // The select's "" option means every day, which is stored as a null weekday.
    const weekdayRaw = String(formData.get(`weekday-${i}`) ?? "");
    const weekday = weekdayRaw === "" ? null : Number(weekdayRaw);
    if (!Number.isFinite(priceInput) || priceInput <= 0) {
      return { error: `Enter a valid rate for tier ${i + 1}.` };
    }
    if (weekday !== null && (!Number.isInteger(weekday) || weekday < 0 || weekday > 6)) {
      return { error: `Tier ${i + 1}: pick a valid day.` };
    }
    if (startMin < 0 || startMin > 1440 || endMin < 0 || endMin > 1440 || startMin >= endMin) {
      return { error: `Tier ${i + 1}: start time must be before end time.` };
    }
    rows.push({ startMin, endMin, weekday, priceCentsPerHour: Math.round(priceInput * 100) });
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
