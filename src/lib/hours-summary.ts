const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_NAMES_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function fmtMin(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  const period = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${period}` : `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

/** Collapses adjacent weekdays with identical hours into readable ranges. */
export function summarizeHours(hours: { weekday: number; openMin: number; closeMin: number }[]): string[] {
  const byDay = new Map<number, { openMin: number; closeMin: number }>();
  for (const h of hours) byDay.set(h.weekday, h);

  type Group = { start: number; end: number; openMin: number; closeMin: number };
  const groups: Group[] = [];
  for (let d = 0; d < 7; d++) {
    const row = byDay.get(d);
    if (!row) continue;
    const last = groups[groups.length - 1];
    if (last && last.end === d - 1 && last.openMin === row.openMin && last.closeMin === row.closeMin) {
      last.end = d;
    } else {
      groups.push({ start: d, end: d, openMin: row.openMin, closeMin: row.closeMin });
    }
  }

  return groups.map((g) => {
    const label = g.start === g.end ? WEEKDAY_NAMES[g.start] : `${WEEKDAY_NAMES[g.start]}–${WEEKDAY_NAMES[g.end]}`;
    const span =
      g.openMin === 0 && g.closeMin === 1440 ? "Open 24 hours" : `${fmtMin(g.openMin)} – ${fmtMin(g.closeMin)}`;
    return `${label}: ${span}`;
  });
}

function minuteOfWeekLabel(minuteOfWeek: number): string {
  const day = Math.floor(minuteOfWeek / 1440) % 7;
  return `${WEEKDAY_NAMES_FULL[day]} ${fmtMin(minuteOfWeek % 1440)}`;
}

/**
 * Finds the single largest weekly-recurring closed window (this business's
 * Sabbath rest) from the open intervals, without needing a separate
 * "closed reason" setting — it's just the complement of the open hours.
 * Returns e.g. "Friday 4 PM → Saturday 6 PM" (no "Closed" prefix — callers
 * compose that themselves since the phrasing differs by page). Returns null
 * if there's no closed time (open 24/7) or no open time at all.
 */
export function closedWindowLabel(hours: { weekday: number; openMin: number; closeMin: number }[]): string | null {
  const WEEK = 7 * 1440;
  const openIntervals: [number, number][] = [];
  for (const h of hours) {
    if (h.closeMin > h.openMin) openIntervals.push([h.weekday * 1440 + h.openMin, h.weekday * 1440 + h.closeMin]);
  }
  if (openIntervals.length === 0) return null;
  openIntervals.sort((a, b) => a[0] - b[0]);

  const closedIntervals: [number, number][] = [];
  let cursor = 0;
  for (const [start, end] of openIntervals) {
    if (start > cursor) closedIntervals.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  if (cursor < WEEK) closedIntervals.push([cursor, WEEK]);

  // The gap before Sunday and the gap after Saturday are really one window.
  if (closedIntervals.length > 1 && closedIntervals[0][0] === 0 && closedIntervals.at(-1)![1] === WEEK) {
    const [, firstEnd] = closedIntervals.shift()!;
    const [lastStart] = closedIntervals.pop()!;
    closedIntervals.push([lastStart, WEEK + firstEnd]);
  }
  if (closedIntervals.length === 0) return null;

  const [start, end] = closedIntervals.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));
  return `${minuteOfWeekLabel(start)} → ${minuteOfWeekLabel(end)}`;
}
