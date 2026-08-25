import { DateTime } from "luxon";

import { restWindowAt, weekdaysTouched, windowsOnWeekday, type RestWindowRow } from "@/lib/rest-windows";

/** Customers can only book courts this many days out from today. */
export const MAX_ADVANCE_DAYS = 30;

/** Longest single reservation, in slots — enforced when a booking is created,
 *  when an admin reschedules one, and advertised by the availability APIs. */
export const MAX_BOOKING_HOURS = 6;

/** Most slots one customer can tick in a single pass of the grid. Bounds the
 *  per-request validation work; the per-court limit is `MAX_BOOKING_HOURS`. */
export const MAX_SELECTED_SLOTS = 24;

export type BusinessHourRow = { weekday: number; openMin: number; closeMin: number };
export type BusyInterval = { start: Date; end: Date };
/** Like `BusyInterval`, but tagged so callers can tell a confirmed booking apart
 *  from one still awaiting payment/call/verification. `bookedBy` is the
 *  customer's display name, carried so the grid can name who holds a slot; it
 *  is optional because not every reader of these intervals needs it. */
export type StatusInterval = { start: Date; end: Date; confirmed: boolean; bookedBy?: string };
export type SlotStatus = "available" | "confirmed" | "pending" | "past" | "rest";
/** `bookedBy` is empty unless the slot is held (`confirmed`/`pending`) *and*
 *  the caller supplied names on `busy` — an elapsed slot never names anyone. */
export type DaySlot = {
  start: Date;
  end: Date;
  label: string;
  available: boolean;
  status: SlotStatus;
  bookedBy: string;
  /** The club's own word for the rest that closes this slot — "Sabbath",
   *  "Morning service". Empty for every status other than `rest`. */
  restLabel: string;
};
export type DayAvailability = { date: string; slots: DaySlot[] };

/** Slot times read as 12-hour with a meridiem, matching how every other page
 * renders a booking time. The ":00" is dropped on the hour so the label stays
 * short enough for a phone-width slot button ("6 PM", "6:30 PM"). */
function formatSlotLabel(startDt: DateTime): string {
  return startDt.minute === 0 ? startDt.toFormat("h a") : startDt.toFormat("h:mm a");
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function isFree(start: Date, end: Date, busy: BusyInterval[]): boolean {
  return !busy.some((b) => overlaps(start, end, b.start, b.end));
}

/**
 * Classifies a single slot for display: elapsed time always reads as "past"
 * (even if it was once confirmed — history isn't bookable or noteworthy),
 * otherwise a confirmed booking wins over a merely-pending one, and a slot
 * too soon to book under the lead-time policy is bucketed with "past" too
 * since it's equally non-interactive right now. When a booking does hold the
 * slot, its customer's name comes back with the status so the caller can say
 * who has it rather than only that it is taken.
 */
function slotStatus(params: {
  startDt: DateTime;
  start: Date;
  end: Date;
  busy: StatusInterval[];
  leadCutoff: DateTime;
  nowDt: DateTime;
}): { status: SlotStatus; bookedBy: string } {
  const { startDt, start, end, busy, leadCutoff, nowDt } = params;
  if (startDt < nowDt) return { status: "past", bookedBy: "" };

  const held = busy.filter((b) => overlaps(start, end, b.start, b.end));
  const holder = held.find((b) => b.confirmed) ?? held[0];
  if (holder) {
    return { status: holder.confirmed ? "confirmed" : "pending", bookedBy: holder.bookedBy ?? "" };
  }

  if (startDt < leadCutoff) return { status: "past", bookedBy: "" };
  return { status: "available", bookedBy: "" };
}

/** A back-to-back run of slots on one court: exactly one Booking row, whose
 *  `hours` column has always meant "this many slots in a row". */
export type SlotRun = { courtId: number; startMs: number; hours: number };

/**
 * Collapse individually-picked slots into the fewest bookings that represent
 * them. Adjacent slots on the same court merge; a gap, or a different court,
 * starts a new run. Duplicates are dropped, so a double-submitted pick can't
 * turn into two overlapping bookings. Shared by the grid and the server action
 * so both agree on what "3 slots" means before and after the round trip.
 */
export function groupSlotsIntoRuns(
  slots: { courtId: number; startMs: number }[],
  slotDurationMin: number,
): SlotRun[] {
  const seen = new Set<string>();
  const sorted = slots
    .filter((s) => {
      const key = `${s.courtId}:${s.startMs}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.courtId - b.courtId || a.startMs - b.startMs);

  const runs: SlotRun[] = [];
  for (const slot of sorted) {
    const last = runs[runs.length - 1];
    if (
      last &&
      last.courtId === slot.courtId &&
      last.startMs + last.hours * slotDurationMin * 60_000 === slot.startMs
    ) {
      last.hours += 1;
    } else {
      runs.push({ courtId: slot.courtId, startMs: slot.startMs, hours: 1 });
    }
  }
  return runs;
}

/** Luxon weekday is 1=Mon..7=Sun; our model is 0=Sun..6=Sat. */
function weekday0Sunday(dt: DateTime): number {
  return dt.weekday % 7;
}


/** UTC instant bounds covering local dates [fromISO, toISO] inclusive, in `tz`. */
export function rangeUtcBounds(tz: string, fromISO: string, toISO: string): { start: Date; end: Date } {
  const start = DateTime.fromISO(fromISO, { zone: tz }).startOf("day");
  const end = DateTime.fromISO(toISO, { zone: tz }).startOf("day").plus({ days: 1 });
  return { start: start.toJSDate(), end: end.toJSDate() };
}

/**
 * Build per-day slot availability across [fromISO, toISO] (inclusive), in the
 * business timezone. `busy` should already be scoped to the single court this
 * is being computed for.
 */
export function buildAvailability(params: {
  tz: string;
  slotDurationMin: number;
  leadMinutes: number;
  hours: BusinessHourRow[];
  blackouts: Set<string>; // YYYY-MM-DD
  /** The club's weekly rests. Enforced over `hours`, not beside them. */
  rest: RestWindowRow[];
  busy: StatusInterval[];
  fromISO: string;
  toISO: string;
  now: Date;
}): DayAvailability[] {
  const { tz, slotDurationMin, leadMinutes, hours, blackouts, rest, busy, fromISO, toISO, now } = params;
  const leadCutoff = DateTime.fromJSDate(now, { zone: tz }).plus({ minutes: leadMinutes });
  const nowDt = DateTime.fromJSDate(now, { zone: tz });

  /* A rest is the one closed stretch the club is actually asked about, so its
     slots are drawn and named rather than left out. "How long is a day" has no
     answer on a day nobody opens, though, so the frame comes from the hours of
     the days that rest actually displaces — a Friday-to-Saturday rest is drawn
     across Friday's and Saturday's own opening times, and an unrelated day that
     happens to open at 5 AM does not stretch it. */
  function restFrame(windows: RestWindowRow[]): { from: number; to: number } | null {
    const days = new Set(windows.flatMap(weekdaysTouched));
    const rows = hours.filter((h) => days.has(h.weekday));
    const src = rows.length > 0 ? rows : hours;
    if (src.length === 0) return null;
    return { from: Math.min(...src.map((h) => h.openMin)), to: Math.max(...src.map((h) => h.closeMin)) };
  }

  const out: DayAvailability[] = [];
  let day = DateTime.fromISO(fromISO, { zone: tz }).startOf("day");
  const last = DateTime.fromISO(toISO, { zone: tz }).startOf("day");

  // Overflow guard mirrors a fixed iteration cap instead of a `while(true)`.
  for (let i = 0; day <= last && i < 400; i++) {
    const dateStr = day.toFormat("yyyy-LL-dd");
    const slots: DaySlot[] = [];

    if (!blackouts.has(dateStr)) {
      const weekday = weekday0Sunday(day);
      for (const h of hours.filter((row) => row.weekday === weekday)) {
        let minute = h.openMin;
        while (minute + slotDurationMin <= h.closeMin) {
          const hh = Math.floor(minute / 60);
          const mm = minute % 60;
          const startDt = day.set({ hour: hh, minute: mm, second: 0, millisecond: 0 });
          if (startDt.isValid) {
            const start = startDt.toJSDate();
            const end = new Date(start.getTime() + slotDurationMin * 60_000);
            /* The rest is checked before anything else, because it outranks
               everything else: an admin who declares a rest has closed that
               time, whatever the weekly hours say and whoever already holds a
               booking there. `isValidSlotStart` refuses the same minutes, so
               the grid and the server cannot drift apart. */
            const resting = restWindowAt(rest, weekday * 1440 + minute);
            if (resting) {
              slots.push({
                start,
                end,
                label: formatSlotLabel(startDt),
                available: false,
                status: "rest",
                bookedBy: "",
                restLabel: resting.label,
              });
            } else {
              const { status, bookedBy } = slotStatus({ startDt, start, end, busy, leadCutoff, nowDt });
              slots.push({
                start,
                end,
                label: formatSlotLabel(startDt),
                available: status === "available",
                status,
                bookedBy,
                restLabel: "",
              });
            }
          }
          minute += slotDurationMin;
        }
      }

      /* Then the rest windows that fall outside the day's opening hours, on the
         same grid of start times so the two read as one column. Without this a
         club whose hours already stop for the rest would show nothing at all
         there, and the day would be a short list that changes length — which is
         exactly what the hours are being drawn around. */
      const taken = new Set(slots.map((s) => s.start.getTime()));
      const frame = restFrame(windowsOnWeekday(rest, weekday));
      for (let minute = frame?.from ?? 0; frame && minute + slotDurationMin <= frame.to; minute += slotDurationMin) {
        const resting = restWindowAt(rest, weekday * 1440 + minute);
        if (!resting) continue;

        const startDt = day.set({ hour: Math.floor(minute / 60), minute: minute % 60, second: 0, millisecond: 0 });
        if (!startDt.isValid) continue;
        const start = startDt.toJSDate();
        if (taken.has(start.getTime())) continue;

        slots.push({
          start,
          end: new Date(start.getTime() + slotDurationMin * 60_000),
          label: formatSlotLabel(startDt),
          available: false,
          status: "rest",
          bookedBy: "",
          restLabel: resting.label,
        });
      }
    }

    slots.sort((a, b) => a.start.getTime() - b.start.getTime());
    out.push({ date: dateStr, slots });
    day = day.plus({ days: 1 });
  }
  return out;
}

/**
 * Validate that `startMs` (unix ms, UTC) is exactly the start of a real,
 * currently-bookable one-slot-duration window. Returns the slot's
 * [start, end) if valid, or null. Used to check every hour of a booking
 * request, including multi-hour ones, one call per hour.
 */
export function isValidSlotStart(params: {
  tz: string;
  slotDurationMin: number;
  leadMinutes: number;
  hours: BusinessHourRow[];
  blackouts: Set<string>;
  /** Refused outright, however the request reached us. */
  rest: RestWindowRow[];
  startMs: number;
  now: Date;
}): { start: Date; end: Date } | null {
  const { tz, slotDurationMin, leadMinutes, hours, blackouts, rest, startMs, now } = params;
  const startDt = DateTime.fromMillis(startMs, { zone: tz });
  if (!startDt.isValid) return null;

  const dateStr = startDt.toFormat("yyyy-LL-dd");
  if (blackouts.has(dateStr)) return null;

  const leadCutoff = DateTime.fromJSDate(now, { zone: tz }).plus({ minutes: leadMinutes });
  if (startDt < leadCutoff) return null;

  const weekday = weekday0Sunday(startDt);
  /* Before the hours are consulted at all: a rest closes the time whatever the
     weekly grid says, and this is the check a hand-made POST has to clear. */
  if (restWindowAt(rest, weekday * 1440 + startDt.hour * 60 + startDt.minute)) return null;

  for (const h of hours.filter((row) => row.weekday === weekday)) {
    let minute = h.openMin;
    while (minute + slotDurationMin <= h.closeMin) {
      const hh = Math.floor(minute / 60);
      const mm = minute % 60;
      const candidate = startDt.set({ hour: hh, minute: mm, second: 0, millisecond: 0 });
      if (candidate.isValid && candidate.toMillis() === startDt.toMillis()) {
        return {
          start: candidate.toJSDate(),
          end: candidate.plus({ minutes: slotDurationMin }).toJSDate(),
        };
      }
      minute += slotDurationMin;
    }
  }
  return null;
}

/**
 * Validate an `hours`-long booking starting at `startMs`: every constituent
 * one-hour slot must be a real, open, non-blacked-out, in-future slot (this
 * also naturally rejects ranges that cross into a blacked-out day). Does not
 * check for existing-booking conflicts — pass `busy` in via the caller's own
 * per-court query and check with `isFree` separately, since that needs a
 * fresh read close to the write.
 */
export function isValidBookingRange(params: {
  tz: string;
  slotDurationMin: number;
  leadMinutes: number;
  hours: BusinessHourRow[];
  blackouts: Set<string>;
  rest: RestWindowRow[];
  startMs: number;
  durationHours: number;
  now: Date;
}): { start: Date; end: Date } | null {
  const { durationHours, startMs, slotDurationMin, ...base } = params;
  if (durationHours < 1) return null;

  let firstStart: Date | null = null;
  let lastEnd: Date | null = null;
  for (let i = 0; i < durationHours; i++) {
    const slot = isValidSlotStart({
      ...base,
      slotDurationMin,
      startMs: startMs + i * slotDurationMin * 60_000,
      now: base.now,
    });
    if (!slot) return null;
    if (i === 0) firstStart = slot.start;
    lastEnd = slot.end;
  }
  if (!firstStart || !lastEnd) return null;
  return { start: firstStart, end: lastEnd };
}
