import { DateTime } from "luxon";
import type { BookingStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import {
  getSettings,
  getBusinessHours,
  getActiveCourts,
  getPriceTiers,
  ACTIVE_STATUSES,
  PENDING_ACTION_STATUSES,
} from "@/lib/booking-data";
import { reapExpiredBookings } from "@/lib/expiry";
import { loadAvailability, serializeBooking, todayISO, localLabel } from "@/lib/agent-api";
import { BOOKING_STATUS_LABELS } from "@/lib/booking-status";
import { summarizeHours, closedWindowLabel } from "@/lib/hours-summary";
import { formatMinuteOfDay, formatMoney } from "@/lib/format";
import { PAY_METHOD_LABELS } from "@/lib/pay-method";
import { computeBookingPriceCents } from "@/lib/pricing";
import { MAX_ADVANCE_DAYS, MAX_BOOKING_HOURS, rangeUtcBounds } from "@/lib/scheduling";

/**
 * The body of each `/api/agent/*` response, split out from the routes so that
 * `/api/agent/all` can assemble every section in one request without either
 * duplicating the query logic or making four HTTP round trips back to itself.
 * Routes keep only their parameter parsing; everything below is shared.
 */

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Default window when a bookings caller gives no dates. */
export const DEFAULT_BOOKING_WINDOW_DAYS = 14;

/** How far ahead the summary looks for each court's next free slot. */
export const NEXT_FREE_LOOKAHEAD_DAYS = 7;

/** Pending-queue depth returned inline by the summary. */
export const PENDING_PREVIEW_LIMIT = 20;

const ALL_STATUSES = Object.keys(BOOKING_STATUS_LABELS) as BookingStatus[];

/**
 * Every accepted `status` value, including plain-language aliases, since the
 * caller is a language model composing a query rather than a form with a
 * fixed dropdown. Keys are matched case-insensitively.
 */
const STATUS_ALIASES: Record<string, readonly BookingStatus[]> = {
  all: ALL_STATUSES,
  active: ACTIVE_STATUSES,
  booked: ["confirmed"],
  confirmed: ["confirmed"],
  pending: PENDING_ACTION_STATUSES,
  awaiting_confirmation: ["awaiting_confirmation"],
  awaiting_call: ["awaiting_call"],
  unpaid: ["pending_payment"],
  pending_payment: ["pending_payment"],
  cancelled: ["cancelled"],
  canceled: ["cancelled"],
  expired: ["expired"],
};

export const STATUS_ALIAS_NAMES = Object.keys(STATUS_ALIASES);

export function resolveStatuses(raw: string | null): BookingStatus[] | { error: string } {
  if (!raw?.trim()) return ALL_STATUSES;

  const out = new Set<BookingStatus>();
  for (const part of raw.split(",")) {
    const key = part.trim().toLowerCase();
    if (!key) continue;
    const mapped = STATUS_ALIASES[key];
    if (!mapped) {
      return { error: `Unknown status "${part.trim()}". Accepted: ${STATUS_ALIAS_NAMES.join(", ")}.` };
    }
    for (const s of mapped) out.add(s);
  }
  return out.size > 0 ? [...out] : ALL_STATUSES;
}

/**
 * Everything an agent needs to interpret the other sections: who the business
 * is, which courts exist, when it's open, what an hour costs, and how a
 * customer can pay. Nothing here is per-customer data.
 */
export async function buildConfigPayload() {
  const [settings, hours, courts, tiers] = await Promise.all([
    getSettings(),
    getBusinessHours(),
    getActiveCourts(),
    getPriceTiers(),
  ]);

  const tz = settings.timezone;
  const today = todayISO(tz);
  // Past closures are noise for an agent answering "can I book on X".
  const blackouts = await prisma.blackoutDate.findMany({
    where: { date: { gte: new Date(`${today}T00:00:00Z`) } },
    orderBy: { date: "asc" },
    take: 100,
  });

  return {
    business: {
      name: settings.businessName,
      contactPerson: settings.contactPerson,
      contactPhone: settings.contactPhone,
      contactEmail: settings.contactEmail,
      address: settings.address,
      timezone: tz,
      currency: settings.currency,
      today,
      nowLocal: DateTime.now().setZone(tz).toFormat("ccc, LLL d, yyyy, h:mm a"),
    },
    bookingRules: {
      slotDurationMin: settings.slotDurationMin,
      maxBookingHours: MAX_BOOKING_HOURS,
      maxAdvanceDays: MAX_ADVANCE_DAYS,
      /** A slot starting sooner than this many minutes from now can't be booked online. */
      leadMinutes: settings.leadMinutes,
      /** How long an unpaid hold survives before the sweep expires it. */
      holdMinutes: settings.holdMinutes,
    },
    courts: courts.map((c) => ({ id: c.id, name: c.name })),
    hours: {
      summary: summarizeHours(hours),
      weeklyClosure: closedWindowLabel(hours),
      byWeekday: hours.map((h) => ({
        weekday: h.weekday,
        day: WEEKDAY_NAMES[h.weekday] ?? String(h.weekday),
        openMin: h.openMin,
        closeMin: h.closeMin,
        opens: formatMinuteOfDay(h.openMin),
        closes: formatMinuteOfDay(h.closeMin),
      })),
    },
    pricing: {
      defaultCentsPerHour: settings.priceCentsPerHour,
      defaultFormatted: formatMoney(settings.priceCentsPerHour, settings.currency),
      // A tier with a `weekday` beats an every-day tier covering the same minute.
      tiers: tiers.map((t) => ({
        startMin: t.startMin,
        endMin: t.endMin,
        window: `${formatMinuteOfDay(t.startMin)} – ${formatMinuteOfDay(t.endMin)}`,
        weekday: t.weekday,
        day: t.weekday == null ? "every day" : (WEEKDAY_NAMES[t.weekday] ?? String(t.weekday)),
        centsPerHour: t.priceCentsPerHour,
        formatted: formatMoney(t.priceCentsPerHour, settings.currency),
      })),
    },
    payment: {
      methods: PAY_METHOD_LABELS,
      gcash: { name: settings.gcashName, number: settings.gcashNumber },
      bdo: { accountName: settings.bdoAccountName, accountNumber: settings.bdoAccountNumber },
      qrph: { accountName: settings.qrphAccountName, accountNumber: settings.qrphAccountNumber },
    },
    upcomingClosures: blackouts.map((b) => ({
      date: b.date.toISOString().slice(0, 10),
      reason: b.reason,
    })),
    bookingStatuses: BOOKING_STATUS_LABELS,
  };
}

export type AvailabilityOptions = {
  fromISO: string;
  days: number;
  courtId: number | null;
  onlyAvailable: boolean;
  /** False drops per-slot detail, leaving the counts and `openRanges` — the
   *  compact shape `/api/agent/all` defaults to so one call stays readable. */
  includeSlots?: boolean;
};

export async function buildAvailabilityPayload(opts: AvailabilityOptions) {
  const { fromISO, days, courtId, onlyAvailable, includeSlots = true } = opts;
  const result = await loadAvailability({ fromISO, days, courtId });
  const { settings } = result;

  return {
    timezone: settings.timezone,
    currency: settings.currency,
    from: result.fromISO,
    to: result.toISO,
    slotDurationMin: settings.slotDurationMin,
    maxBookingHours: MAX_BOOKING_HOURS,
    slotsIncluded: includeSlots,
    courts: result.courts.map((court) => ({
      courtId: court.courtId,
      courtName: court.courtName,
      days: court.days.map((day) => {
        const base = {
          date: day.date,
          availableSlots: day.availableSlots,
          totalSlots: day.totalSlots,
          openRanges: day.openRanges,
        };
        if (!includeSlots) return base;
        return { ...base, slots: onlyAvailable ? day.slots.filter((s) => s.available) : day.slots };
      }),
    })),
  };
}

export type BookingsOptions = {
  statuses: BookingStatus[];
  fromISO: string;
  toISO: string;
  courtId: number | null;
  limit: number;
  includeContact: boolean;
};

export async function buildBookingsPayload(opts: BookingsOptions) {
  const { statuses, fromISO, toISO, courtId, limit, includeContact } = opts;
  const [settings, tiers] = await Promise.all([getSettings(), getPriceTiers()]);
  const tz = settings.timezone;

  // Flip any lapsed holds before reading, so a hold that timed out isn't
  // reported as still pending. Throttled — this is a read path.
  await reapExpiredBookings();

  const { start, end } = rangeUtcBounds(tz, fromISO, toISO);
  const where = {
    status: { in: statuses },
    startUtc: { gte: start, lt: end },
    ...(courtId === null ? {} : { courtId }),
  };

  const [rows, totalMatching] = await Promise.all([
    prisma.booking.findMany({
      where,
      include: { court: true, customer: true, payment: true },
      orderBy: { startUtc: "asc" },
      take: limit,
    }),
    prisma.booking.count({ where }),
  ]);

  const countsByStatus: Record<string, number> = {};
  for (const r of rows) countsByStatus[r.status] = (countsByStatus[r.status] ?? 0) + 1;

  return {
    timezone: tz,
    currency: settings.currency,
    from: fromISO,
    to: toISO,
    statuses,
    courtId,
    count: rows.length,
    totalMatching,
    /* Signals that `countsByStatus` describes the returned page, not the whole
       window — otherwise an agent would confidently under-report. */
    truncated: totalMatching > rows.length,
    countsByStatus,
    contactIncluded: includeContact,
    bookings: rows.map((b) =>
      serializeBooking(b, {
        tz,
        currency: settings.currency,
        slotDurationMin: settings.slotDurationMin,
        fallbackCentsPerHour: settings.priceCentsPerHour,
        tiers,
        includeContact,
      }),
    ),
  };
}

/**
 * One section for "how does today look": bookings by status, revenue, per-court
 * occupancy, everything still waiting on the admin, and the next free slot on
 * each court — so an agent can answer an operational question without
 * aggregating the other sections itself.
 */
export async function buildSummaryPayload(opts: { dateISO: string; includeContact: boolean }) {
  const { dateISO, includeContact } = opts;
  const [settings, tiers] = await Promise.all([getSettings(), getPriceTiers()]);
  const tz = settings.timezone;

  await reapExpiredBookings();

  const { start, end } = rangeUtcBounds(tz, dateISO, dateISO);
  const [dayRows, pendingRows, pendingTotal, availability] = await Promise.all([
    prisma.booking.findMany({
      where: { startUtc: { gte: start, lt: end } },
      select: { status: true, hours: true, startUtc: true, courtId: true },
    }),
    prisma.booking.findMany({
      where: { status: { in: [...PENDING_ACTION_STATUSES] } },
      include: { court: true, customer: true, payment: true },
      orderBy: { startUtc: "asc" },
      take: PENDING_PREVIEW_LIMIT,
    }),
    prisma.booking.count({ where: { status: { in: [...PENDING_ACTION_STATUSES] } } }),
    // Day 0 is the requested date (occupancy); the rest of the window is only
    // scanned to find each court's next free slot.
    loadAvailability({ fromISO: dateISO, days: NEXT_FREE_LOOKAHEAD_DAYS, courtId: null }),
  ]);

  const byStatus: Record<string, number> = {};
  for (const r of dayRows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;

  const confirmedRevenueCents = dayRows
    .filter((r) => r.status === "confirmed")
    .reduce(
      (sum, r) =>
        sum +
        computeBookingPriceCents({
          startMs: r.startUtc.getTime(),
          hours: r.hours,
          slotDurationMin: settings.slotDurationMin,
          tz,
          tiers,
          fallbackCentsPerHour: settings.priceCentsPerHour,
        }),
      0,
    );

  const slotHours = settings.slotDurationMin / 60;
  const courts = availability.courts.map((court) => {
    const day = court.days[0];
    const slots = day?.slots ?? [];
    const bookedSlots = slots.filter((s) => s.status === "confirmed").length;
    const pendingSlots = slots.filter((s) => s.status === "pending").length;
    const availableSlots = slots.filter((s) => s.available).length;
    // Elapsed slots are neither bookable nor a gap someone can still fill, so
    // utilization is measured against the day's whole open schedule.
    const utilizationPct = slots.length > 0 ? Math.round(((bookedSlots + pendingSlots) / slots.length) * 1000) / 10 : 0;

    const nextFree = court.days.flatMap((d) => d.slots).find((s) => s.available) ?? null;

    return {
      courtId: court.courtId,
      courtName: court.courtName,
      totalSlots: slots.length,
      bookedSlots,
      pendingSlots,
      availableSlots,
      bookedHours: Math.round(bookedSlots * slotHours * 100) / 100,
      openHours: Math.round(slots.length * slotHours * 100) / 100,
      utilizationPct,
      openRanges: day?.openRanges ?? [],
      nextAvailable: nextFree
        ? {
            date: nextFree.date,
            time: nextFree.time,
            startUtc: nextFree.startUtc,
            startLocal: localLabel(new Date(nextFree.startUtc), tz),
          }
        : null,
    };
  });

  const serializeCtx = {
    tz,
    currency: settings.currency,
    slotDurationMin: settings.slotDurationMin,
    fallbackCentsPerHour: settings.priceCentsPerHour,
    tiers,
    includeContact,
  };

  return {
    date: dateISO,
    timezone: tz,
    currency: settings.currency,
    nowLocal: DateTime.now().setZone(tz).toFormat("ccc, LLL d, yyyy, h:mm a"),
    generatedAtUtc: new Date().toISOString(),
    /** True when the business is closed all day (weekly rest day or a blackout date). */
    closedAllDay: courts.every((c) => c.totalSlots === 0),
    day: {
      totalBookings: dayRows.length,
      byStatus,
      confirmedRevenueCents,
      confirmedRevenueFormatted: formatMoney(confirmedRevenueCents, settings.currency),
    },
    courts,
    needsAction: {
      count: pendingTotal,
      truncated: pendingTotal > pendingRows.length,
      bookings: pendingRows.map((b) => serializeBooking(b, serializeCtx)),
    },
    nextFreeLookaheadDays: NEXT_FREE_LOOKAHEAD_DAYS,
  };
}
