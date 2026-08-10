/** Minutes-from-midnight (0..1440) to an "HH:MM" string for a <input type="time">. */
export function minutesToTime(min: number): string {
  const clamped = ((min % 1440) + 1440) % 1440; // 1440 (midnight-as-end-of-day) displays as 00:00
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

/** `formatMoney` without the trailing ".00" on whole amounts — for the dense
 * phone-width grid, where "₱200" fits a column that "₱200.00" does not. */
export function formatMoneyCompact(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

/** Minutes-from-midnight (0..1440) to a label like "8 AM" or "1:30 PM". */
export function formatMinuteOfDay(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  const period = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${period}` : `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

/** A plain YYYY-MM-DD calendar date split into the three stacked lines of a
 * date-strip cell — e.g. `{ weekday: "Sat", day: "15", month: "Aug" }`. */
export function dateStripParts(iso: string): { weekday: string; day: string; month: string } {
  const dt = new Date(`${iso}T00:00:00Z`);
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(dt);
  return {
    weekday: part({ weekday: "short" }),
    day: part({ day: "numeric" }),
    month: part({ month: "short" }),
  };
}

/** Same calendar-date rules as `formatDateLabel` but without the weekday, for
 * tight phone-width rows where the full label would wrap. */
export function formatDateLabelShort(iso: string): string {
  const dt = new Date(`${iso}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(dt);
}

/** `iso` is a plain YYYY-MM-DD business-local calendar date; render its
 * components as-is, with no timezone conversion (parse and format both as
 * UTC so the date never shifts by a day). */
export function formatDateLabel(iso: string): string {
  const dt = new Date(`${iso}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(dt);
}
