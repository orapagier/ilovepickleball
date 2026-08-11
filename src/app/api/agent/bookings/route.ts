import type { NextRequest } from "next/server";
import { DateTime } from "luxon";
import { getSettings } from "@/lib/booking-data";
import { agentAuthFailure, agentJson, agentError } from "@/lib/agent-auth";
import { parseISODate, parseInteger, todayISO } from "@/lib/agent-api";
import { buildBookingsPayload, resolveStatuses, DEFAULT_BOOKING_WINDOW_DAYS } from "@/lib/agent-payloads";

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
  const settings = await getSettings();
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
        .plus({ days: DEFAULT_BOOKING_WINDOW_DAYS - 1 })
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

  return agentJson(await buildBookingsPayload({ statuses, fromISO, toISO, courtId, limit, includeContact }));
}
