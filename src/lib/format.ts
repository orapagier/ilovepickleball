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
