import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { reapExpiredBookings } from "@/lib/expiry";
import type { BusinessHourRow, BusyInterval, StatusInterval } from "@/lib/scheduling";
import type { PriceTier } from "@/lib/pricing";

/** Booking statuses that occupy a slot (block double-booking a court). */
export const ACTIVE_STATUSES = [
  "pending_payment",
  "awaiting_confirmation",
  "awaiting_call",
  "confirmed",
] as const;

/** Bookings still waiting on the admin to act, shown in the admin queue. */
export const PENDING_ACTION_STATUSES = ["awaiting_confirmation", "awaiting_call"] as const;

// Wrapped in React's `cache()` so the site header and the page it wraps
// (which both need settings/courts/hours on every request) share one DB
// round trip instead of each firing its own query.
export const getSettings = cache(async () => {
  const settings = await prisma.setting.findUnique({ where: { id: 1 } });
  if (!settings) {
    throw new Error("Settings row missing — run `npx prisma db seed`.");
  }
  return settings;
});

export const getBusinessHours = cache(async (): Promise<BusinessHourRow[]> => {
  return prisma.businessHour.findMany({ orderBy: [{ weekday: "asc" }, { openMin: "asc" }] });
});

/** All blackout dates as a set of "YYYY-MM-DD" strings (small dataset, no need to range-filter). */
export const getBlackoutDateSet = cache(async (): Promise<Set<string>> => {
  const rows = await prisma.blackoutDate.findMany({ select: { date: true } });
  return new Set(rows.map((r) => r.date.toISOString().slice(0, 10)));
});

export const getActiveCourts = cache(async () => {
  return prisma.court.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });
});

export const getPriceTiers = cache(async (): Promise<PriceTier[]> => {
  return prisma.priceTier.findMany({ orderBy: { startMin: "asc" } });
});

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

/** Same as `getBusyIntervals`, but tags each interval as confirmed or still-pending so
 *  callers (the availability API) can color slots instead of just marking them taken. */
export async function getBusyIntervalsWithStatus(courtId: number, from: Date, to: Date): Promise<StatusInterval[]> {
  await reapExpiredBookings();
  const rows = await prisma.booking.findMany({
    where: {
      courtId,
      status: { in: [...ACTIVE_STATUSES] },
      endUtc: { gt: from },
      startUtc: { lt: to },
    },
    select: { startUtc: true, endUtc: true, status: true },
  });
  return rows.map((r) => ({ start: r.startUtc, end: r.endUtc, confirmed: r.status === "confirmed" }));
}
