import type { NextRequest } from "next/server";
import { getSettings } from "@/lib/booking-data";
import { agentAuthFailure, agentJson, agentError } from "@/lib/agent-auth";
import { parseISODate, todayISO } from "@/lib/agent-api";
import { buildSummaryPayload } from "@/lib/agent-payloads";

/**
 * GET /api/agent/summary?date=YYYY-MM-DD&contact=true
 *
 * One call for "how does today look": bookings by status, revenue, per-court
 * occupancy, everything still waiting on the admin, and the next free slot on
 * each court. Built so an agent can answer an operational question without
 * fetching and aggregating the other endpoints itself.
 */
export async function GET(req: NextRequest) {
  const denied = agentAuthFailure(req);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const settings = await getSettings();

  const rawDate = searchParams.get("date");
  const dateISO = rawDate ? parseISODate(rawDate) : todayISO(settings.timezone);
  if (!dateISO) return agentError("`date` must be a valid YYYY-MM-DD date.");

  const includeContact = searchParams.get("contact") === "true";

  return agentJson(await buildSummaryPayload({ dateISO, includeContact }));
}
