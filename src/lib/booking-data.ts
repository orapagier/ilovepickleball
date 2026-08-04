import { prisma } from "@/lib/prisma";
import { reapExpiredBookings } from "@/lib/expiry";
import type { BusinessHourRow, BusyInterval } from "@/lib/scheduling";

/** Booking statuses that occupy a slot (block double-booking a court). */
export const ACTIVE_STATUSES = [
  "pending_payment",
  "awaiting_confirmation",
  "awaiting_call",
  "confirmed",
] as const;

/** Bookings still waiting on the admin to act, shown in the admin queue. */
export const PENDING_ACTION_STATUSES = ["awaiting_confirmation", "awaiting_call"] as const;

export async function getSettings() {
  const settings = await prisma.setting.findUnique({ where: { id: 1 } });
  if (!settings) {
    throw new Error("Settings row missing — run `npx prisma db seed`.");
  }
  return settings;
}

export async function getBusinessHours(): Promise<BusinessHourRow[]> {
  return prisma.businessHour.findMany({ orderBy: [{ weekday: "asc" }, { openMin: "asc" }] });
}

/** All blackout dates as a set of "YYYY-MM-DD" strings (small dataset, no need to range-filter). */
export async function getBlackoutDateSet(): Promise<Set<string>> {
  const rows = await prisma.blackoutDate.findMany({ select: { date: true } });
  return new Set(rows.map((r) => r.date.toISOString().slice(0, 10)));
}

export async function getActiveCourts() {
  return prisma.court.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });
}

/** Busy intervals for a single court overlapping [from, to). Reaps expired holds first. */
export async function getBusyIntervals(courtId: number, from: Date, to: Date): Promise<BusyInterval[]> {
  await reapExpiredBookings();
  const rows = await prisma.booking.findMany({
    where: {
      courtId,
      status: { in: [...ACTIVE_STATUSES] },
      endUtc: { gt: from },
      startUtc: { lt: to },
    },
    select: { startUtc: true, endUtc: true },
  });
  return rows.map((r) => ({ start: r.startUtc, end: r.endUtc }));
}
