import { NextRequest, NextResponse } from "next/server";
import { DateTime } from "luxon";
import {
  getSettings,
  getBusinessHours,
  getBlackoutDateSet,
  getBusyIntervalsByCourt,
  getPriceTiers,
  getRestWindows,
} from "@/lib/booking-data";
import { buildAvailability, rangeUtcBounds, MAX_BOOKING_HOURS } from "@/lib/scheduling";

/** Enough for any club this runs for, and a bound on what one request can ask
 *  the database to group. */
const MAX_COURTS_PER_REQUEST = 20;

/**
 * GET /api/availability?courts=1,2&date=YYYY-MM-DD
 *
 * Returns the requested day's slots plus the following day's for every court
 * asked about, flattened per court into one time-ordered list, so the client
 * can offer multi-hour durations that cross midnight (this business runs close
 * to 24/7 most of the week).
 *
 * Several courts in one call on purpose. The grid used to fetch each court
 * separately, and since every one of those requests re-read the same settings,
 * hours, rests, blackouts and tiers, the cost of drawing the grid grew with the
 * number of courts for no reason — the day's configuration is the same for all
 * of them. Asked together it is two round trips whatever the court count.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");
  const courtIds = (searchParams.get("courts") ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);

  if (courtIds.length === 0 || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "courts (comma-separated ids) and date (YYYY-MM-DD) are required" }, { status: 400 });
  }
  if (courtIds.length > MAX_COURTS_PER_REQUEST) {
    return NextResponse.json({ error: `at most ${MAX_COURTS_PER_REQUEST} courts per request` }, { status: 400 });
  }

  /* Five independent reads, so they go together — awaited one after another
     they cost five serial round trips to the database, which dominates this
     route's latency when the region is far from the user. */
  const [settings, hours, blackouts, tiers, rest] = await Promise.all([
    getSettings(),
    getBusinessHours(),
    getBlackoutDateSet(),
    getPriceTiers(),
    getRestWindows(),
  ]);

  const nextDate = DateTime.fromISO(date, { zone: settings.timezone }).plus({ days: 1 }).toFormat("yyyy-LL-dd");
  const { start } = rangeUtcBounds(settings.timezone, date, date);
  const { end } = rangeUtcBounds(settings.timezone, nextDate, nextDate);
  const busyByCourt = await getBusyIntervalsByCourt(courtIds, start, end);

  const now = new Date();
  const slotsByCourt: Record<number, unknown[]> = {};
  for (const courtId of courtIds) {
    const days = buildAvailability({
      tz: settings.timezone,
      slotDurationMin: settings.slotDurationMin,
      leadMinutes: settings.leadMinutes,
      hours,
      blackouts,
      rest,
      busy: busyByCourt.get(courtId) ?? [],
      fromISO: date,
      toISO: nextDate,
      now,
    });

    slotsByCourt[courtId] = days.flatMap((day) =>
      day.slots.map((s) => ({
        date: day.date,
        startMs: s.start.getTime(),
        label: s.label,
        available: s.available,
        status: s.status,
        bookedBy: s.bookedBy,
        restLabel: s.restLabel,
      })),
    );
  }

  return NextResponse.json({
    date,
    slotsByCourt,
    priceCentsPerHour: settings.priceCentsPerHour,
    currency: settings.currency,
    slotDurationMin: settings.slotDurationMin,
    maxHours: MAX_BOOKING_HOURS,
    tiers,
  });
}
