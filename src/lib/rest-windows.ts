import { formatMinuteOfDay } from "@/lib/format";
import { localMinuteOfDay, localWeekday } from "@/lib/pricing";

/**
 * A club's weekly rest, as data rather than a constant.
 *
 * This used to be `SABBATH_START`/`SABBATH_END` in `hours-summary.ts`, fixed at
 * Friday 5 PM → Saturday 6 PM. That is one congregation's practice; a club that
 * rests Sunday morning, keeps a midweek meeting, or never closes at all could
 * not say so. Every rule here works on any window, any number of them, and on
 * none.
 *
 * Everything is arithmetic on the *minute of the week* — Sunday 00:00 is 0,
 * Saturday 23:59 is 10079. A window is the half-open span `[start, end)`, which
 * is what lets one wrap past Saturday into Sunday without any special case
 * downstream: `windowSpans` hands back the one or two ordinary spans it covers,
 * and every other function here is written against those.
 */

const WEEKDAY_NAMES_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const WEEK_MINUTES = 7 * 1440;
export const DAY_MINUTES = 1440;

/** The stored shape, and the only thing any rule here needs. */
export type RestWindowRow = {
  id: number;
  startWeekday: number;
  startMinute: number;
  endWeekday: number;
  endMinute: number;
  label: string;
  noteTitle: string;
  noteBody: string;
  quote: string;
  quoteSource: string;
};

export function windowStart(w: RestWindowRow): number {
  return w.startWeekday * DAY_MINUTES + w.startMinute;
}

export function windowEnd(w: RestWindowRow): number {
  return w.endWeekday * DAY_MINUTES + w.endMinute;
}

/**
 * The window as ordinary non-wrapping `[from, to)` spans of minutes-of-week.
 *
 * One span normally; two when it runs past the end of Saturday into Sunday.
 * Equal ends are an *empty* window rather than a whole week: an admin who
 * hasn't finished filling the form in should not have the courts shut for
 * seven days while they think about it.
 */
export function windowSpans(w: RestWindowRow): [number, number][] {
  const from = windowStart(w);
  const to = windowEnd(w);
  if (from === to) return [];
  if (to > from) return [[from, to]];
  return [
    [from, WEEK_MINUTES],
    [0, to],
  ];
}

export function coversMinuteOfWeek(w: RestWindowRow, minuteOfWeek: number): boolean {
  return windowSpans(w).some(([from, to]) => minuteOfWeek >= from && minuteOfWeek < to);
}

/** The first window covering this minute, or null. Order is the admin's. */
export function restWindowAt(windows: RestWindowRow[], minuteOfWeek: number): RestWindowRow | null {
  return windows.find((w) => coversMinuteOfWeek(w, minuteOfWeek)) ?? null;
}

/** Where `now` falls in the business's week. */
export function minuteOfWeekNow(tz: string, now: Date = new Date()): number {
  return localWeekday(now, tz) * DAY_MINUTES + localMinuteOfDay(now, tz);
}

/** The rest currently running, if one is — asked on the server so both renders
 *  agree on the answer. */
export function activeRestWindow(
  windows: RestWindowRow[],
  tz: string,
  now: Date = new Date(),
): RestWindowRow | null {
  return restWindowAt(windows, minuteOfWeekNow(tz, now));
}

/**
 * Windows that touch a given weekday, in the order they start on it.
 *
 * A day is touched if any span of the window overlaps it at all, so both ends
 * of a Friday-to-Saturday rest bring their note to their own day — the way the
 * Sabbath card used to appear on exactly those two.
 */
export function windowsOnWeekday(windows: RestWindowRow[], weekday: number): RestWindowRow[] {
  const dayFrom = weekday * DAY_MINUTES;
  const dayTo = dayFrom + DAY_MINUTES;
  return windows
    .filter((w) => windowSpans(w).some(([from, to]) => from < dayTo && dayFrom < to))
    .sort((a, b) => windowStart(a) - windowStart(b));
}

/** Every weekday a window touches — one for a rest inside a single day, two for
 *  one that runs overnight or across the week boundary. */
export function weekdaysTouched(w: RestWindowRow): number[] {
  const days: number[] = [];
  for (let d = 0; d < 7; d++) {
    const from = d * DAY_MINUTES;
    if (windowSpans(w).some(([a, b]) => a < from + DAY_MINUTES && from < b)) days.push(d);
  }
  return days;
}

/** "Friday 5 PM" — one end of a window, written out. */
export function restBound(weekday: number, minute: number): string {
  return `${WEEKDAY_NAMES_FULL[weekday] ?? "?"} ${formatMinuteOfDay(minute)}`;
}

/** "Friday 5 PM → Saturday 6 PM" — the whole window, for a note or a summary. */
export function restWindowSpanLabel(w: RestWindowRow): string {
  return `${restBound(w.startWeekday, w.startMinute)} → ${restBound(w.endWeekday, w.endMinute)}`;
}
