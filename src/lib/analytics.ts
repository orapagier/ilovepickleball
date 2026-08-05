import { DateTime } from "luxon";
import { prisma } from "@/lib/prisma";
import { getSettings, getBusinessHours, getBlackoutDateSet, getActiveCourts, getPriceTiers } from "@/lib/booking-data";
import { computeBookingPriceCents } from "@/lib/pricing";

export type DashboardStats = {
  periodLabel: string;
  todayBookings: number;
  periodBookings: number;
  periodBookingsPctChange: number;
  netRevenueCents: number;
  netRevenuePctChange: number;
  courtUtilizationPct: number;
  dailyRevenue: { day: number; cents: number }[];
  avgProjectedCentsPerDay: number;
};

function pctChange(curr: number, prev: number): number {
  if (prev === 0) return curr === 0 ? 0 : 100;
  return ((curr - prev) / prev) * 100;
}

/** Confirmed-bookings revenue, booking counts, and court utilization for the
 *  current calendar month (business-local), compared against the prior month.
 *  Prices are computed with today's rate tiers, same approximation the rest
 *  of the admin UI already makes — bookings don't snapshot price. */
export async function getDashboardStats(): Promise<DashboardStats> {
  const [settings, hours, blackouts, courts, tiers] = await Promise.all([
    getSettings(),
    getBusinessHours(),
    getBlackoutDateSet(),
    getActiveCourts(),
    getPriceTiers(),
  ]);
  const tz = settings.timezone;
  const now = DateTime.now().setZone(tz);
  const todayStart = now.startOf("day");
  const monthStart = now.startOf("month");
  const monthEnd = monthStart.plus({ months: 1 });
  const prevMonthStart = monthStart.minus({ months: 1 });
  const daysInMonth = monthStart.daysInMonth ?? 30;

  const [todayBookings, periodRows, prevPeriodRows] = await Promise.all([
    prisma.booking.count({
      where: {
        status: "confirmed",
        startUtc: { gte: todayStart.toJSDate(), lt: todayStart.plus({ days: 1 }).toJSDate() },
      },
    }),
    prisma.booking.findMany({
      where: { status: "confirmed", startUtc: { gte: monthStart.toJSDate(), lt: monthEnd.toJSDate() } },
      select: { hours: true, startUtc: true },
    }),
    prisma.booking.findMany({
      where: { status: "confirmed", startUtc: { gte: prevMonthStart.toJSDate(), lt: monthStart.toJSDate() } },
      select: { hours: true, startUtc: true },
    }),
  ]);

  const priceOf = (b: { startUtc: Date; hours: number }) =>
    computeBookingPriceCents({
      startMs: b.startUtc.getTime(),
      hours: b.hours,
      slotDurationMin: settings.slotDurationMin,
      tz,
      tiers,
      fallbackCentsPerHour: settings.priceCentsPerHour,
    });

  const netRevenueCents = periodRows.reduce((sum, b) => sum + priceOf(b), 0);
  const prevNetRevenueCents = prevPeriodRows.reduce((sum, b) => sum + priceOf(b), 0);
  const bookedHours = periodRows.reduce((sum, b) => sum + b.hours, 0);

  const byDay = new Map<number, number>();
  for (const b of periodRows) {
    const day = DateTime.fromJSDate(b.startUtc).setZone(tz).day;
    byDay.set(day, (byDay.get(day) ?? 0) + priceOf(b));
  }
  const dailyRevenue = Array.from({ length: daysInMonth }, (_, i) => ({
    day: i + 1,
    cents: byDay.get(i + 1) ?? 0,
  }));

  const elapsedDays = Math.min(now.day, daysInMonth);
  const revenueToDate = dailyRevenue.slice(0, elapsedDays).reduce((sum, d) => sum + d.cents, 0);
  const avgProjectedCentsPerDay = elapsedDays > 0 ? Math.round(revenueToDate / elapsedDays) : 0;

  let totalAvailableMinutes = 0;
  for (let i = 0, day = monthStart; i < daysInMonth; i++, day = day.plus({ days: 1 })) {
    if (blackouts.has(day.toFormat("yyyy-LL-dd"))) continue;
    const weekday = day.weekday % 7;
    for (const h of hours) {
      if (h.weekday === weekday) totalAvailableMinutes += Math.max(0, h.closeMin - h.openMin);
    }
  }
  const totalAvailableHours = (totalAvailableMinutes / 60) * Math.max(courts.length, 1);
  const courtUtilizationPct = totalAvailableHours > 0 ? (bookedHours / totalAvailableHours) * 100 : 0;

  return {
    periodLabel: monthStart.toFormat("LLLL yyyy"),
    todayBookings,
    periodBookings: periodRows.length,
    periodBookingsPctChange: pctChange(periodRows.length, prevPeriodRows.length),
    netRevenueCents,
    netRevenuePctChange: pctChange(netRevenueCents, prevNetRevenueCents),
    courtUtilizationPct,
    dailyRevenue,
    avgProjectedCentsPerDay,
  };
}
