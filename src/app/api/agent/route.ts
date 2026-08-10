import type { NextRequest } from "next/server";
import { agentAuthFailure, agentJson } from "@/lib/agent-auth";

/**
 * GET /api/agent
 * Self-describing index of the read-only agent API, so a custom AI agent can be
 * pointed at one URL and discover the rest (and their parameters) at runtime.
 */
export async function GET(req: NextRequest) {
  const denied = agentAuthFailure(req);
  if (denied) return denied;

  return agentJson({
    name: "Smash Zone booking — agent read API",
    description:
      "Read-only access to courts, availability, bookings and daily operations. " +
      "All times are returned as UTC ISO strings plus a business-local label. Money is in cents.",
    auth: "Send `Authorization: Bearer <AGENT_API_KEY>` (or `x-api-key: <AGENT_API_KEY>`) on every request.",
    endpoints: [
      {
        path: "/api/agent/config",
        description:
          "Business details, courts, opening hours, price tiers, payment channels and upcoming closures. Read this first — it explains the vocabulary used by the other endpoints.",
        params: {},
      },
      {
        path: "/api/agent/availability",
        description: "Free and taken slots per court, with contiguous open ranges ready to offer a caller.",
        params: {
          date: "YYYY-MM-DD business-local start date (default: today)",
          days: "1-14 calendar days to cover (default: 1)",
          courtId: "restrict to one court (default: every active court)",
          onlyAvailable: "true to omit taken/past slots from `slots` (open ranges are unaffected)",
        },
      },
      {
        path: "/api/agent/bookings",
        description:
          "Reservations filtered by status and date. Covers booked, pending-confirmation, cancelled and expired slots.",
        params: {
          status:
            "comma-separated. Aliases: booked/confirmed, pending (awaiting_confirmation+awaiting_call), unpaid (pending_payment), cancelled, expired, active, all. Default: all",
          from: "YYYY-MM-DD business-local, inclusive (default: today)",
          to: "YYYY-MM-DD business-local, inclusive (default: from + 13 days)",
          courtId: "restrict to one court",
          limit: "1-200 (default: 100)",
          contact: "true to include customer email and phone — omitted by default",
        },
      },
      {
        path: "/api/agent/summary",
        description:
          "Today at a glance: counts by status, what needs admin action, per-court occupancy, and the next free slot on each court.",
        params: { date: "YYYY-MM-DD business-local day to summarize (default: today)" },
      },
    ],
  });
}
