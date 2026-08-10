import { NextRequest, NextResponse } from "next/server";
import { DateTime } from "luxon";
import {
  getSettings,
  getBusinessHours,
  getBlackoutDateSet,
  getBusyIntervalsWithStatus,
  getPriceTiers,
} from "@/lib/booking-data";
import { buildAvailability, rangeUtcBounds, MAX_BOOKING_HOURS } from "@/lib/scheduling";

/**
 * GET /api/availability?courtId=1&date=YYYY-MM-DD
 * Returns the requested day's slots plus the following day's, flattened into
 * one time-ordered list, so the client can offer multi-hour durations that
 * cross midnight (this business runs close to 24/7 most of the week).
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const courtId = Number(searchParams.get("courtId"));
  const date = searchParams.get("date");

  if (!Number.isFinite(courtId) || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "courtId and date (YYYY-MM-DD) are required" }, { status: 400 });
  }

  /* Four independent reads, so they go together — awaited one after another
     they cost four serial round trips to the database, which dominates this
     route's latency when the region is far from the user. */
  const [settings, hours, blackouts, tiers] = await Promise.all([
    getSettings(),
    getBusinessHours(),
    getBlackoutDateSet(),
    getPriceTiers(),
  ]);

  const nextDate = DateTime.fromISO(date, { zone: settings.timezone }).plus({ days: 1 }).toFormat("yyyy-LL-dd");
  const { start } = rangeUtcBounds(settings.timezone, date, date);
  const { end } = rangeUtcBounds(settings.timezone, nextDate, nextDate);
  const busy = await getBusyIntervalsWithStatus(courtId, start, end);

  const days = buildAvailability({
    tz: settings.timezone,
    slotDurationMin: settings.slotDurationMin,
    leadMinutes: settings.leadMinutes,
    hours,
    blackouts,
    busy,
    fromISO: date,
    toISO: nextDate,
    now: new Date(),
  });

  const slots = days.flatMap((day) =>
    day.slots.map((s) => ({
      date: day.date,
      startMs: s.start.getTime(),
      label: s.label,
      available: s.available,
      status: s.status,
    })),
  );

  return NextResponse.json({
    date,
    slots,
    priceCentsPerHour: settings.priceCentsPerHour,
    currency: settings.currency,
    slotDurationMin: settings.slotDurationMin,
    maxHours: MAX_BOOKING_HOURS,
    tiers,
  });
}
