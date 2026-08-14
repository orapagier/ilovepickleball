import { DateTime } from "luxon";

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
/** Like `BusyInterval`, but tagged so callers can tell a confirmed booking apart from one still awaiting payment/call/verification. */
export type StatusInterval = { start: Date; end: Date; confirmed: boolean };
export type SlotStatus = "available" | "confirmed" | "pending" | "past";
export type DaySlot = { start: Date; end: Date; label: string; available: boolean; status: SlotStatus };
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
 * since it's equally non-interactive right now.
 */
function slotStatus(params: {
  startDt: DateTime;
  start: Date;
  end: Date;
  busy: StatusInterval[];
  leadCutoff: DateTime;
  nowDt: DateTime;
}): SlotStatus {
  const { startDt, start, end, busy, leadCutoff, nowDt } = params;
  if (startDt < nowDt) return "past";
  if (busy.some((b) => b.confirmed && overlaps(start, end, b.start, b.end))) return "confirmed";
  if (busy.some((b) => !b.confirmed && overlaps(start, end, b.start, b.end))) return "pending";
  if (startDt < leadCutoff) return "past";
  return "available";
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
  busy: StatusInterval[];
  fromISO: string;
  toISO: string;
  now: Date;
}): DayAvailability[] {
  const { tz, slotDurationMin, leadMinutes, hours, blackouts, busy, fromISO, toISO, now } = params;
  const leadCutoff = DateTime.fromJSDate(now, { zone: tz }).plus({ minutes: leadMinutes });
  const nowDt = DateTime.fromJSDate(now, { zone: tz });

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
            const status = slotStatus({ startDt, start, end, busy, leadCutoff, nowDt });
            slots.push({
              start,
              end,
              label: formatSlotLabel(startDt),
              available: status === "available",
              status,
            });
          }
          minute += slotDurationMin;
        }
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
  startMs: number;
  now: Date;
}): { start: Date; end: Date } | null {
  const { tz, slotDurationMin, leadMinutes, hours, blackouts, startMs, now } = params;
  const startDt = DateTime.fromMillis(startMs, { zone: tz });
  if (!startDt.isValid) return null;

  const dateStr = startDt.toFormat("yyyy-LL-dd");
  if (blackouts.has(dateStr)) return null;

  const leadCutoff = DateTime.fromJSDate(now, { zone: tz }).plus({ minutes: leadMinutes });
  if (startDt < leadCutoff) return null;

  const weekday = weekday0Sunday(startDt);
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
  startMs: number;
  durationHours: number;
  now: Date;
}): { start: Date; end: Date } | null {
  const { durationHours, startMs, slotDurationMin, ...rest } = params;
  if (durationHours < 1) return null;

  let firstStart: Date | null = null;
  let lastEnd: Date | null = null;
  for (let i = 0; i < durationHours; i++) {
    const slot = isValidSlotStart({
      ...rest,
      slotDurationMin,
      startMs: startMs + i * slotDurationMin * 60_000,
      now: rest.now,
    });
    if (!slot) return null;
    if (i === 0) firstStart = slot.start;
    lastEnd = slot.end;
  }
  if (!firstStart || !lastEnd) return null;
  return { start: firstStart, end: lastEnd };
}
