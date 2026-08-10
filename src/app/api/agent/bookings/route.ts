import type { NextRequest } from "next/server";
import type { BookingStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { getSettings, getPriceTiers, ACTIVE_STATUSES, PENDING_ACTION_STATUSES } from "@/lib/booking-data";
import { reapExpiredBookings } from "@/lib/expiry";
import { agentAuthFailure, agentJson, agentError } from "@/lib/agent-auth";
import { serializeBooking, parseISODate, parseInteger, todayISO } from "@/lib/agent-api";
import { BOOKING_STATUS_LABELS } from "@/lib/booking-status";
import { rangeUtcBounds } from "@/lib/scheduling";
import { DateTime } from "luxon";

const ALL_STATUSES = Object.keys(BOOKING_STATUS_LABELS) as BookingStatus[];

/** Default window when the caller gives no dates — "what's on the books" almost
 *  always means the near future, and an unbounded query would drag in years of history. */
const DEFAULT_WINDOW_DAYS = 14;

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

function resolveStatuses(raw: string | null): BookingStatus[] | { error: string } {
  if (!raw?.trim()) return ALL_STATUSES;

  const out = new Set<BookingStatus>();
  for (const part of raw.split(",")) {
    const key = part.trim().toLowerCase();
    if (!key) continue;
    const mapped = STATUS_ALIASES[key];
    if (!mapped) {
      return { error: `Unknown status "${part.trim()}". Accepted: ${Object.keys(STATUS_ALIASES).join(", ")}.` };
    }
    for (const s of mapped) out.add(s);
  }
  return out.size > 0 ? [...out] : ALL_STATUSES;
}

/**
 * GET /api/agent/bookings?status=pending&from=YYYY-MM-DD&to=YYYY-MM-DD&courtId=1&limit=100&contact=true
 *
 * Reservations in a date window, filtered by status — this one endpoint answers
 * "what's booked", "what's waiting on me to confirm", and "what got cancelled",
 * since those differ only by status. Dates filter on the booking's *start*, in
 * business-local time.
 *
 * Customer email and phone are withheld unless `contact=true`, so a routine
 * "what's on today" answer can't spill a customer list.
 */
export async function GET(req: NextRequest) {
  const denied = agentAuthFailure(req);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const [settings, tiers] = await Promise.all([getSettings(), getPriceTiers()]);
  const tz = settings.timezone;

  const statuses = resolveStatuses(searchParams.get("status"));
  if ("error" in statuses) return agentError(statuses.error);

  const rawFrom = searchParams.get("from");
  const fromISO = rawFrom ? parseISODate(rawFrom) : todayISO(tz);
  if (!fromISO) return agentError("`from` must be a valid YYYY-MM-DD date.");

  const rawTo = searchParams.get("to");
  const toISO = rawTo
    ? parseISODate(rawTo)
    : DateTime.fromISO(fromISO, { zone: tz })
        .plus({ days: DEFAULT_WINDOW_DAYS - 1 })
        .toFormat("yyyy-LL-dd");
  if (!toISO) return agentError("`to` must be a valid YYYY-MM-DD date.");
  if (toISO < fromISO) return agentError("`to` must not be earlier than `from`.");

  const rawCourt = searchParams.get("courtId");
  let courtId: number | null = null;
  if (rawCourt !== null) {
    courtId = Number(rawCourt);
    if (!Number.isInteger(courtId)) return agentError("`courtId` must be an integer.");
  }

  const limit = parseInteger(searchParams.get("limit"), 100, 1, 200);
  const includeContact = searchParams.get("contact") === "true";

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

  return agentJson({
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
  });
}
