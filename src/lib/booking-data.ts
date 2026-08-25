import { prisma, withDbRetry } from "@/lib/prisma";
import { reapExpiredBookings } from "@/lib/expiry";
import type { BusinessHourRow, BusyInterval, StatusInterval } from "@/lib/scheduling";
import type { PriceTier } from "@/lib/pricing";
import type { RestWindowRow } from "@/lib/rest-windows";

/** Booking statuses that occupy a slot (block double-booking a court). */
export const ACTIVE_STATUSES = [
  "pending_payment",
  "awaiting_confirmation",
  "awaiting_call",
  "confirmed",
] as const;

/** Bookings still waiting on the admin to act, shown in the admin queue. */
export const PENDING_ACTION_STATUSES = ["awaiting_confirmation", "awaiting_call"] as const;

/* ------------------------------------------------------------------ *
 * The club's configuration
 * ------------------------------------------------------------------ *
 *
 * Settings, hours, rests, blackouts, courts and price tiers are read by
 * practically every route, change only when an admin edits them, and are a
 * few dozen rows in total. The database is a continent away — a round trip is
 * 300-500ms — so what these cost is not the query but the trip.
 *
 * They used to be wrapped in React's `cache()`, which dedupes within a single
 * request and nothing more. That is no help to the availability grid, whose
 * fetches are separate HTTP requests: each one re-read all six.
 *
 * `cachedConfig` holds the *promise* in module scope instead, so callers that
 * arrive together share one in-flight query and callers that arrive later
 * share the settled answer. Admin writes call `bustConfigCache` and see their
 * edit immediately; the TTL is the backstop for the deployments where that
 * cannot work — on serverless each instance has its own memory, so another
 * instance only learns of an edit by its entry expiring.
 */

/** How stale a config read may be on an instance that missed the write. */
const CONFIG_TTL_MS = 30_000;

type CachedConfig = { value: Promise<unknown>; at: number };
const configCache = new Map<string, CachedConfig>();

function cachedConfig<T>(key: string, load: () => Promise<T>): () => Promise<T> {
  return () => {
    const hit = configCache.get(key);
    if (hit && Date.now() - hit.at < CONFIG_TTL_MS) return hit.value as Promise<T>;
    /* A failure must not be remembered: the link to the database drops often
       enough that caching one rejection would turn a blip into 30 seconds of
       a site that believes it has no business hours. */
    const value = load().catch((error) => {
      if (configCache.get(key)?.value === value) configCache.delete(key);
      throw error;
    });
    configCache.set(key, { value, at: Date.now() });
    return value as Promise<T>;
  };
}

/** Drop the memo after an admin edits any of it. Cheap, and clearing all of it
 *  rather than one key keeps callers from having to know which reads their
 *  write touched. */
export function bustConfigCache(): void {
  configCache.clear();
}

export const getSettings = cachedConfig("settings", async () => {
  const settings = await withDbRetry(() => prisma.setting.findUnique({ where: { id: 1 } }));
  if (!settings) {
    throw new Error("Settings row missing — run `npx prisma db seed`.");
  }
  return settings;
});

export const getBusinessHours = cachedConfig("hours", async (): Promise<BusinessHourRow[]> => {
  return withDbRetry(() => prisma.businessHour.findMany({ orderBy: [{ weekday: "asc" }, { openMin: "asc" }] }));
});

/** The club's weekly rests, in the admin's own order — the first window that
 *  covers a minute is the one that names it. */
export const getRestWindows = cachedConfig("rest", async (): Promise<RestWindowRow[]> => {
  return withDbRetry(() => prisma.restWindow.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }));
});

/** All blackout dates as a set of "YYYY-MM-DD" strings (small dataset, no need to range-filter). */
export const getBlackoutDateSet = cachedConfig("blackouts", async (): Promise<Set<string>> => {
  const rows = await withDbRetry(() => prisma.blackoutDate.findMany({ select: { date: true } }));
  return new Set(rows.map((r) => r.date.toISOString().slice(0, 10)));
});

export const getActiveCourts = cachedConfig("courts", async () => {
  return withDbRetry(() => prisma.court.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }));
});

export const getPriceTiers = cachedConfig("tiers", async (): Promise<PriceTier[]> => {
  return withDbRetry(() => prisma.priceTier.findMany({ orderBy: { startMin: "asc" } }));
});

/** Busy intervals for a single court overlapping [from, to). Reaps expired holds
 *  first, unconditionally — this feeds the conflict check when a booking is
 *  created, where a hold left un-reaped would wrongly block a free slot. */
export async function getBusyIntervals(courtId: number, from: Date, to: Date): Promise<BusyInterval[]> {
  await reapExpiredBookings({ force: true });
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

/**
 * Every court's busy intervals in one query, grouped by court id.
 *
 * Each interval is tagged confirmed-or-still-pending so the grid can colour a
 * slot rather than only mark it taken, and carries who holds it so the slot can
 * say so. Courts with nothing booked come back with an empty array, not a
 * missing key.
 *
 * One query for all courts rather than one per court: both callers that want
 * this — the agent API and the booking grid — want every court at once, and a
 * query each would be a round trip each to a database a continent away.
 *
 * Display-only, so it takes the throttled sweep rather than forcing one.
 */
export async function getBusyIntervalsByCourt(
  courtIds: number[],
  from: Date,
  to: Date,
): Promise<Map<number, StatusInterval[]>> {
  await reapExpiredBookings();
  const byCourt = new Map<number, StatusInterval[]>(courtIds.map((id) => [id, []]));
  if (courtIds.length === 0) return byCourt;

  const rows = await prisma.booking.findMany({
    where: {
      courtId: { in: courtIds },
      status: { in: [...ACTIVE_STATUSES] },
      endUtc: { gt: from },
      startUtc: { lt: to },
    },
    select: {
      courtId: true,
      startUtc: true,
      endUtc: true,
      status: true,
      customer: { select: { name: true } },
      tournament: { select: { name: true } },
    },
  });
  for (const r of rows) {
    byCourt.get(r.courtId)?.push({
      start: r.startUtc,
      end: r.endUtc,
      confirmed: r.status === "confirmed",
      // A tournament's court block is owned by the admin who published it, but
      // what the grid should say is which tournament has the court.
      bookedBy: r.tournament?.name ?? r.customer.name.trim(),
    });
  }
  return byCourt;
}
