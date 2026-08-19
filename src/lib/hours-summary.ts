import { formatMinuteOfDay } from "@/lib/format";
import { localMinuteOfDay, localWeekday } from "@/lib/pricing";

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_NAMES_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The Sabbath this business keeps: sunset Friday to sunset Saturday, held as
 *  fixed local clock times the same way the open hours are, and deliberately
 *  separate from them — the courts reopen an hour after the Sabbath ends, so
 *  the closed window and the Sabbath itself are not the same span. */
export const SABBATH_START = { weekday: 5, minute: 17 * 60 };
export const SABBATH_END = { weekday: 6, minute: 17 * 60 };

/** "Friday 5:00 PM" — one end of the Sabbath, written out. */
export function sabbathBound(bound: { weekday: number; minute: number }): string {
  return `${WEEKDAY_NAMES_FULL[bound.weekday]} ${formatMinuteOfDay(bound.minute)}`;
}

/** Is the Sabbath running right now, by the business's own clock? Asked on the
 *  server so the answer is one value both renders agree on. */
export function isSabbathNow(tz: string, now: Date = new Date()): boolean {
  const minuteOfWeek = localWeekday(now, tz) * 1440 + localMinuteOfDay(now, tz);
  return (
    minuteOfWeek >= SABBATH_START.weekday * 1440 + SABBATH_START.minute &&
    minuteOfWeek < SABBATH_END.weekday * 1440 + SABBATH_END.minute
  );
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
      g.openMin === 0 && g.closeMin === 1440
        ? "Open 24 hours"
        : `${formatMinuteOfDay(g.openMin)} – ${formatMinuteOfDay(g.closeMin)}`;
    return `${label}: ${span}`;
  });
}

function minuteOfWeekLabel(minuteOfWeek: number): string {
  const day = Math.floor(minuteOfWeek / 1440) % 7;
  return `${WEEKDAY_NAMES_FULL[day]} ${formatMinuteOfDay(minuteOfWeek % 1440)}`;
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
