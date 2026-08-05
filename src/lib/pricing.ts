export type PriceTier = { startMin: number; endMin: number; priceCentsPerHour: number };

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

/** Rate for the hour-block starting at `minuteOfDay`; falls back to the flat rate if no tier covers it. */
export function tierRateForMinute(minuteOfDay: number, tiers: PriceTier[], fallbackCentsPerHour: number): number {
  const tier = tiers.find((t) => minuteOfDay >= t.startMin && minuteOfDay < t.endMin);
  return tier ? tier.priceCentsPerHour : fallbackCentsPerHour;
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
    const rate = tierRateForMinute(minuteOfDay, tiers, fallbackCentsPerHour);
    total += Math.round((rate * slotDurationMin) / 60);
  }
  return total;
}
