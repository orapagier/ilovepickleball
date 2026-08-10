import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * Auth for the `/api/agent/*` read API, which a headless AI agent calls with a
 * static key. Deliberately separate from the customer/admin session in
 * `auth.ts`: Google OAuth needs a browser, so a script can't hold a session,
 * and an agent shouldn't inherit an admin's write powers just to read.
 */

/** Compares as fixed-width digests so the check can't leak the key's length. */
function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function presentedKey(req: Request): string | null {
  // `Authorization: Bearer <key>` is the norm; `x-api-key` is accepted too
  // because some agent HTTP-tool configs can only set a plain header.
  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  return bearer?.trim() || req.headers.get("x-api-key")?.trim() || null;
}

/**
 * Returns the response to send back when the caller isn't authorized, or null
 * when it is — so a route reads `const denied = agentAuthFailure(req); if (denied) return denied;`.
 *
 * Fails closed: with no `AGENT_API_KEY` configured the API is off rather than
 * open, so a missing env var on a fresh deploy can't publish every booking.
 */
export function agentAuthFailure(req: Request): NextResponse | null {
  const expected = process.env.AGENT_API_KEY?.trim();
  if (!expected) {
    return NextResponse.json(
      { error: "Agent API is disabled. Set AGENT_API_KEY to enable it." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  const presented = presentedKey(req);
  if (!presented || !timingSafeEqual(digest(presented), digest(expected))) {
    return NextResponse.json(
      { error: "Unauthorized. Send `Authorization: Bearer <AGENT_API_KEY>`." },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  return null;
}

/** JSON response for agent routes — never cached, since every field is live operational state. */
export function agentJson(data: unknown, init?: { status?: number }): NextResponse {
  return NextResponse.json(data, {
    status: init?.status ?? 200,
    headers: { "cache-control": "no-store" },
  });
}

export function agentError(message: string, status = 400): NextResponse {
  return agentJson({ error: message }, { status });
}
