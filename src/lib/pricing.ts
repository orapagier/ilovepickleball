/** `weekday` is 0=Sun..6=Sat, or null for a band that applies every day. */
export type PriceTier = { startMin: number; endMin: number; weekday: number | null; priceCentsPerHour: number };

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Business-local minutes-from-midnight for an instant, via Intl (works in both server and client code, no timezone lib needed). */
export function localMinuteOfDay(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

/** Business-local weekday (0=Sun..6=Sat) for an instant, same Intl approach as `localMinuteOfDay`. */
export function localWeekday(date: Date, tz: string): number {
  const short = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(date);
  return WEEKDAY_INDEX[short] ?? 0;
}

/**
 * Rate for the hour-block starting at `minuteOfDay` on `weekday`; falls back to
 * the flat rate if no tier covers it. A tier pinned to this weekday wins over
 * one that covers the same minute on every day, so an every-day band can be
 * left in place as the general case and overridden a day at a time.
 */
export function tierRateForMinute(
  minuteOfDay: number,
  weekday: number,
  tiers: PriceTier[],
  fallbackCentsPerHour: number,
): number {
  const covering = tiers.filter(
    (t) => minuteOfDay >= t.startMin && minuteOfDay < t.endMin && (t.weekday === null || t.weekday === weekday),
  );
  if (covering.length === 0) return fallbackCentsPerHour;
  return (covering.find((t) => t.weekday !== null) ?? covering[0]).priceCentsPerHour;
}

/** The cheapest applicable rate, for "Starts at ₱X/hour" display. */
export function minTierRateCents(tiers: PriceTier[], fallbackCentsPerHour: number): number {
  if (tiers.length === 0) return fallbackCentsPerHour;
  return Math.min(...tiers.map((t) => t.priceCentsPerHour));
}

/** Sums each `slotDurationMin`-long block's tiered rate across `hours` blocks starting at `startMs`. */
export function computeBookingPriceCents(params: {
  startMs: number;
  hours: number;
  slotDurationMin: number;
  tz: string;
  tiers: PriceTier[];
  fallbackCentsPerHour: number;
}): number {
  const { startMs, hours, slotDurationMin, tz, tiers, fallbackCentsPerHour } = params;
  let total = 0;
  for (let i = 0; i < hours; i++) {
    const blockStart = new Date(startMs + i * slotDurationMin * 60_000);
    const minuteOfDay = localMinuteOfDay(blockStart, tz);
    /* Derived per block, not per booking — a booking that runs past midnight
       crosses into the next day's rates. */
    const rate = tierRateForMinute(minuteOfDay, localWeekday(blockStart, tz), tiers, fallbackCentsPerHour);
    total += Math.round((rate * slotDurationMin) / 60);
  }
  return total;
}
