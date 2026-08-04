"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSessionUser, type SessionUser } from "@/lib/auth-helpers";

export type ActionState = { error?: string; ok?: boolean };

async function requireAdminOrThrow(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/api/auth/signin");
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
  await prisma.booking.update({ where: { id: bookingId }, data: { status: "confirmed", payMethod: "gcash" } });
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
  // Invalid GCash reference: convert straight to a confirmed, pay-cash-on-site
  // booking rather than bouncing back for resubmission.
  await prisma.booking.update({ where: { id: bookingId }, data: { status: "confirmed", payMethod: "cash_onsite" } });
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

// ---- Settings -------------------------------------------------------------

export async function updateSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdminOrThrow();

  const businessName = String(formData.get("businessName") ?? "").trim();
  const contactPerson = String(formData.get("contactPerson") ?? "").trim();
  const contactPhone = String(formData.get("contactPhone") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const priceInput = Number(formData.get("price"));
  const currency = String(formData.get("currency") ?? "PHP").trim().toUpperCase();
  const timezone = String(formData.get("timezone") ?? "Asia/Manila").trim();
  const gcashName = String(formData.get("gcashName") ?? "").trim();
  const gcashNumber = String(formData.get("gcashNumber") ?? "").trim();
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
      address,
      priceCentsPerHour: Math.round(priceInput * 100),
      currency,
      timezone,
      gcashName,
      gcashNumber,
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
