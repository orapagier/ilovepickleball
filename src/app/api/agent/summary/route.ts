import type { NextRequest } from "next/server";
import { DateTime } from "luxon";
import { prisma } from "@/lib/prisma";
import { getSettings, getPriceTiers, PENDING_ACTION_STATUSES } from "@/lib/booking-data";
import { reapExpiredBookings } from "@/lib/expiry";
import { agentAuthFailure, agentJson, agentError } from "@/lib/agent-auth";
import { loadAvailability, serializeBooking, parseISODate, todayISO, localLabel } from "@/lib/agent-api";
import { computeBookingPriceCents } from "@/lib/pricing";
import { formatMoney } from "@/lib/format";
import { rangeUtcBounds } from "@/lib/scheduling";

/** How far ahead to look for each court's next free slot. */
const NEXT_FREE_LOOKAHEAD_DAYS = 7;

/** Queue depth returned inline; the full list lives at /api/agent/bookings?status=pending. */
const PENDING_PREVIEW_LIMIT = 20;

/**
 * GET /api/agent/summary?date=YYYY-MM-DD&contact=true
 *
 * One call for "how does today look": bookings by status, revenue, per-court
 * occupancy, everything still waiting on the admin, and the next free slot on
 * each court. Built so an agent can answer an operational question without
 * fetching and aggregating the other endpoints itself.
 */
export async function GET(req: NextRequest) {
  const denied = agentAuthFailure(req);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const [settings, tiers] = await Promise.all([getSettings(), getPriceTiers()]);
  const tz = settings.timezone;

  const rawDate = searchParams.get("date");
  const dateISO = rawDate ? parseISODate(rawDate) : todayISO(tz);
  if (!dateISO) return agentError("`date` must be a valid YYYY-MM-DD date.");
  const includeContact = searchParams.get("contact") === "true";

  await reapExpiredBookings();

  const { start, end } = rangeUtcBounds(tz, dateISO, dateISO);
  const [dayRows, pendingRows, pendingTotal, availability] = await Promise.all([
    prisma.booking.findMany({
      where: { startUtc: { gte: start, lt: end } },
      select: { status: true, hours: true, startUtc: true, courtId: true },
    }),
    prisma.booking.findMany({
      where: { status: { in: [...PENDING_ACTION_STATUSES] } },
      include: { court: true, customer: true, payment: true },
      orderBy: { startUtc: "asc" },
      take: PENDING_PREVIEW_LIMIT,
    }),
    prisma.booking.count({ where: { status: { in: [...PENDING_ACTION_STATUSES] } } }),
    // Day 0 is the requested date (occupancy); the rest of the window is only
    // scanned to find each court's next free slot.
    loadAvailability({ fromISO: dateISO, days: NEXT_FREE_LOOKAHEAD_DAYS, courtId: null }),
  ]);

  const byStatus: Record<string, number> = {};
  for (const r of dayRows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;

  const confirmedRevenueCents = dayRows
    .filter((r) => r.status === "confirmed")
    .reduce(
      (sum, r) =>
        sum +
        computeBookingPriceCents({
          startMs: r.startUtc.getTime(),
          hours: r.hours,
          slotDurationMin: settings.slotDurationMin,
          tz,
          tiers,
          fallbackCentsPerHour: settings.priceCentsPerHour,
        }),
      0,
    );

  const slotHours = settings.slotDurationMin / 60;
  const courts = availability.courts.map((court) => {
    const day = court.days[0];
    const slots = day?.slots ?? [];
    const bookedSlots = slots.filter((s) => s.status === "confirmed").length;
    const pendingSlots = slots.filter((s) => s.status === "pending").length;
    const availableSlots = slots.filter((s) => s.available).length;
    // Elapsed slots are neither bookable nor a gap someone can still fill, so
    // utilization is measured against the day's whole open schedule.
    const utilizationPct = slots.length > 0 ? Math.round(((bookedSlots + pendingSlots) / slots.length) * 1000) / 10 : 0;

    const nextFree = court.days.flatMap((d) => d.slots).find((s) => s.available) ?? null;

    return {
      courtId: court.courtId,
      courtName: court.courtName,
      totalSlots: slots.length,
      bookedSlots,
      pendingSlots,
      availableSlots,
      bookedHours: Math.round(bookedSlots * slotHours * 100) / 100,
      openHours: Math.round(slots.length * slotHours * 100) / 100,
      utilizationPct,
      openRanges: day?.openRanges ?? [],
      nextAvailable: nextFree
        ? {
            date: nextFree.date,
            time: nextFree.time,
            startUtc: nextFree.startUtc,
            startLocal: localLabel(new Date(nextFree.startUtc), tz),
          }
        : null,
    };
  });

  const serializeCtx = {
    tz,
    currency: settings.currency,
    slotDurationMin: settings.slotDurationMin,
    fallbackCentsPerHour: settings.priceCentsPerHour,
    tiers,
    includeContact,
  };

  return agentJson({
    date: dateISO,
    timezone: tz,
    currency: settings.currency,
    nowLocal: DateTime.now().setZone(tz).toFormat("ccc, LLL d, yyyy, h:mm a"),
    generatedAtUtc: new Date().toISOString(),
    /** True when the business is closed all day (weekly rest day or a blackout date). */
    closedAllDay: courts.every((c) => c.totalSlots === 0),
    day: {
      totalBookings: dayRows.length,
      byStatus,
      confirmedRevenueCents,
      confirmedRevenueFormatted: formatMoney(confirmedRevenueCents, settings.currency),
    },
    courts,
    needsAction: {
      count: pendingTotal,
      truncated: pendingTotal > pendingRows.length,
      bookings: pendingRows.map((b) => serializeBooking(b, serializeCtx)),
    },
    nextFreeLookaheadDays: NEXT_FREE_LOOKAHEAD_DAYS,
  });
}
