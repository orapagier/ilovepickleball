import { DateTime } from "luxon";
import {
  getSettings,
  getBusinessHours,
  getBlackoutDateSet,
  getActiveCourts,
  getPriceTiers,
  getBusyIntervalsByCourt,
  getRestWindows,
} from "@/lib/booking-data";
import { buildAvailability, rangeUtcBounds, type DaySlot, type SlotStatus } from "@/lib/scheduling";
import { computeBookingPriceCents, localMinuteOfDay, localWeekday, tierRateForMinute } from "@/lib/pricing";
import { bookingStatusLabel } from "@/lib/booking-status";
import { formatMinuteOfDay, formatMoney } from "@/lib/format";
import { PAY_METHOD_LABELS } from "@/lib/pay-method";

/**
 * Shared query + serialization for the `/api/agent/*` routes. Everything an
 * agent reads is shaped for a language model rather than a UI: every instant
 * carries both a machine ISO string and a business-local label, and every
 * amount carries both cents and a formatted string, so the model never has to
 * do timezone or currency math to answer a question.
 */

/** Largest window a single availability call may span, to bound the response size. */
export const MAX_AVAILABILITY_DAYS = 14;

export function todayISO(tz: string): string {
  return DateTime.now().setZone(tz).toFormat("yyyy-LL-dd");
}

/** Parses a YYYY-MM-DD parameter, rejecting both malformed and impossible dates ("2026-02-31"). */
export function parseISODate(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const dt = DateTime.fromISO(value, { zone: "utc" });
  return dt.isValid && dt.toFormat("yyyy-LL-dd") === value ? value : null;
}

export function parseInteger(value: string | null, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!value || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** "Tue, Aug 11, 2026, 6:00 PM" — the business-local reading of an instant. */
export function localLabel(date: Date, tz: string): string {
  return DateTime.fromJSDate(date, { zone: tz }).toFormat("ccc, LLL d, yyyy, h:mm a");
}

/** "6 PM" / "6:30 PM", matching how slot times read everywhere else in the app. */
function timeLabel(date: Date, tz: string): string {
  return formatMinuteOfDay(localMinuteOfDay(date, tz));
}

export type AgentSlot = {
  date: string;
  time: string;
  startUtc: string;
  endUtc: string;
  status: SlotStatus;
  available: boolean;
  priceCentsPerHour: number;
};

/** A contiguous run of free slots — what an agent actually offers a caller ("6 PM to 9 PM is open"). */
export type AgentOpenRange = {
  date: string;
  label: string;
  startUtc: string;
  endUtc: string;
  hours: number;
};

export type AgentCourtDay = {
  date: string;
  availableSlots: number;
  totalSlots: number;
  openRanges: AgentOpenRange[];
  slots: AgentSlot[];
};

export type AgentCourtAvailability = {
  courtId: number;
  courtName: string;
  days: AgentCourtDay[];
};

function openRanges(date: string, slots: DaySlot[], tz: string): AgentOpenRange[] {
  const out: AgentOpenRange[] = [];
  let run: DaySlot[] = [];

  const flush = () => {
    if (run.length === 0) return;
    const first = run[0];
    const last = run[run.length - 1];
    const ms = last.end.getTime() - first.start.getTime();
    out.push({
      date,
      label: `${timeLabel(first.start, tz)} – ${timeLabel(last.end, tz)}`,
      startUtc: first.start.toISOString(),
      endUtc: last.end.toISOString(),
      hours: Math.round((ms / 3_600_000) * 100) / 100,
    });
    run = [];
  };

  for (const slot of slots) {
    if (!slot.available) {
      flush();
      continue;
    }
    // A gap in the schedule (a mid-day closure) breaks the run even though both
    // sides are bookable — they aren't one continuous reservation.
    const prev = run[run.length - 1];
    if (prev && prev.end.getTime() !== slot.start.getTime()) flush();
    run.push(slot);
  }
  flush();
  return out;
}

/**
 * Slot-level availability for one or all active courts across `days` calendar
 * days starting at `fromISO`, in the business timezone.
 */
export async function loadAvailability(params: { fromISO: string; days: number; courtId?: number | null }) {
  const { fromISO, days, courtId } = params;
  const [settings, hours, blackouts, allCourts, tiers, rest] = await Promise.all([
    getSettings(),
    getBusinessHours(),
    getBlackoutDateSet(),
    getActiveCourts(),
    getPriceTiers(),
    getRestWindows(),
  ]);

  const tz = settings.timezone;
  const courts = courtId == null ? allCourts : allCourts.filter((c) => c.id === courtId);
  const toISO = DateTime.fromISO(fromISO, { zone: tz })
    .plus({ days: days - 1 })
    .toFormat("yyyy-LL-dd");

  const { start, end } = rangeUtcBounds(tz, fromISO, toISO);
  const busyByCourt = await getBusyIntervalsByCourt(
    courts.map((c) => c.id),
    start,
    end,
  );
  const now = new Date();

  const availability: AgentCourtAvailability[] = courts.map((court) => {
    const dayRows = buildAvailability({
      tz,
      slotDurationMin: settings.slotDurationMin,
      leadMinutes: settings.leadMinutes,
      hours,
      blackouts,
      rest,
      busy: busyByCourt.get(court.id) ?? [],
      fromISO,
      toISO,
      now,
    });

    return {
      courtId: court.id,
      courtName: court.name,
      days: dayRows.map((day) => ({
        date: day.date,
        availableSlots: day.slots.filter((s) => s.available).length,
        totalSlots: day.slots.length,
        openRanges: openRanges(day.date, day.slots, tz),
        slots: day.slots.map((s) => ({
          date: day.date,
          time: s.label,
          startUtc: s.start.toISOString(),
          endUtc: s.end.toISOString(),
          status: s.status,
          available: s.available,
          priceCentsPerHour: tierRateForMinute(
            localMinuteOfDay(s.start, tz),
            localWeekday(s.start, tz),
            tiers,
            settings.priceCentsPerHour,
          ),
        })),
      })),
    };
  });

  return { settings, fromISO, toISO, courts: availability };
}

/** A booking row with everything `serializeBooking` needs joined in. */
export type BookingWithRelations = {
  id: string;
  courtId: number;
  court: { id: number; name: string };
  customer: { id: string; name: string; email: string; phone: string };
  startUtc: Date;
  endUtc: Date;
  hours: number;
  status: string;
  payMethod: string | null;
  expiresAt: Date | null;
  customerNote: string;
  createdAt: Date;
  updatedAt: Date;
  payment: {
    status: string;
    referenceNumber: string;
    amountCents: number;
    submittedAt: Date;
    verifiedAt: Date | null;
    rejectReason: string;
  } | null;
};

export type SerializeContext = {
  tz: string;
  currency: string;
  slotDurationMin: number;
  fallbackCentsPerHour: number;
  tiers: Parameters<typeof computeBookingPriceCents>[0]["tiers"];
  /** Opt-in per request: without it, customer email and phone stay out of the response. */
  includeContact: boolean;
};

export function serializeBooking(b: BookingWithRelations, ctx: SerializeContext) {
  const priceCents = computeBookingPriceCents({
    startMs: b.startUtc.getTime(),
    hours: b.hours,
    slotDurationMin: ctx.slotDurationMin,
    tz: ctx.tz,
    tiers: ctx.tiers,
    fallbackCentsPerHour: ctx.fallbackCentsPerHour,
  });

  // Bookings carry real customers' contact details, so the default shape gives
  // an agent enough to identify a reservation out loud without handing it a
  // directory of everyone's email and phone number.
  const firstName = b.customer.name.trim().split(/\s+/)[0] ?? "";
  const customer = ctx.includeContact
    ? {
        id: b.customer.id,
        name: b.customer.name,
        email: b.customer.email,
        phone: b.customer.phone,
      }
    : { id: b.customer.id, firstName };

  return {
    id: b.id,
    status: b.status,
    statusLabel: bookingStatusLabel(b),
    court: { id: b.court.id, name: b.court.name },
    startUtc: b.startUtc.toISOString(),
    endUtc: b.endUtc.toISOString(),
    startLocal: localLabel(b.startUtc, ctx.tz),
    endLocal: localLabel(b.endUtc, ctx.tz),
    date: DateTime.fromJSDate(b.startUtc, { zone: ctx.tz }).toFormat("yyyy-LL-dd"),
    hours: b.hours,
    priceCents,
    priceFormatted: formatMoney(priceCents, ctx.currency),
    payMethod: b.payMethod,
    payMethodLabel: b.payMethod ? (PAY_METHOD_LABELS[b.payMethod] ?? b.payMethod) : null,
    // Only set while a hold is ticking; the sweep in `expiry.ts` flips lapsed ones.
    expiresAtUtc: b.expiresAt?.toISOString() ?? null,
    customerNote: b.customerNote,
    customer,
    payment: b.payment
      ? {
          status: b.payment.status,
          referenceNumber: b.payment.referenceNumber,
          amountCents: b.payment.amountCents,
          submittedAtUtc: b.payment.submittedAt.toISOString(),
          verifiedAtUtc: b.payment.verifiedAt?.toISOString() ?? null,
          rejectReason: b.payment.rejectReason,
        }
      : null,
    createdAtUtc: b.createdAt.toISOString(),
    updatedAtUtc: b.updatedAt.toISOString(),
  };
}
