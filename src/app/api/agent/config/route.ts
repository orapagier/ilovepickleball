import type { NextRequest } from "next/server";
import { agentAuthFailure, agentJson } from "@/lib/agent-auth";
import { buildConfigPayload } from "@/lib/agent-payloads";

/**
 * GET /api/agent/config
 * Everything an agent needs to interpret the other endpoints: who the business
 * is, which courts exist, when it's open, what an hour costs, and how a
 * customer can pay. Nothing here is per-customer data.
 */
export async function GET(req: NextRequest) {
  const denied = agentAuthFailure(req);
  if (denied) return denied;

  return agentJson(await buildConfigPayload());
}
