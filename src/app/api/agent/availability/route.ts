import type { NextRequest } from "next/server";
import { agentAuthFailure, agentJson, agentError } from "@/lib/agent-auth";
import { parseISODate, parseInteger, todayISO, MAX_AVAILABILITY_DAYS } from "@/lib/agent-api";
import { buildAvailabilityPayload } from "@/lib/agent-payloads";
import { getSettings } from "@/lib/booking-data";

/**
 * GET /api/agent/availability?date=YYYY-MM-DD&days=1&courtId=1&onlyAvailable=true
 *
 * Slot-by-slot availability for every active court (or one), plus `openRanges`
 * — the contiguous free blocks an agent can actually offer a caller without
 * having to stitch adjacent slots together itself.
 *
 * Slot `status` is one of: available, confirmed (booked and paid), pending
 * (held or awaiting verification — not bookable), past (elapsed, or too soon
 * to book under the lead-time rule).
 */
export async function GET(req: NextRequest) {
  const denied = agentAuthFailure(req);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const settings = await getSettings();

  const rawDate = searchParams.get("date");
  const fromISO = rawDate ? parseISODate(rawDate) : todayISO(settings.timezone);
  if (!fromISO) return agentError("`date` must be a valid YYYY-MM-DD date.");

  const days = parseInteger(searchParams.get("days"), 1, 1, MAX_AVAILABILITY_DAYS);

  const rawCourt = searchParams.get("courtId");
  let courtId: number | null = null;
  if (rawCourt !== null) {
    courtId = Number(rawCourt);
    if (!Number.isInteger(courtId)) return agentError("`courtId` must be an integer.");
  }

  const onlyAvailable = searchParams.get("onlyAvailable") === "true";

  const payload = await buildAvailabilityPayload({ fromISO, days, courtId, onlyAvailable });
  if (courtId !== null && payload.courts.length === 0) {
    return agentError(`No active court with id ${courtId}.`, 404);
  }

  return agentJson(payload);
}
