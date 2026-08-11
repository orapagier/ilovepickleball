import { createSign } from "node:crypto";

/**
 * Access tokens for a Google service account, minted from the signed-JWT grant.
 *
 * Written against the REST endpoint directly instead of pulling in `googleapis`:
 * the whole flow is one signature and one POST, and the package would add tens
 * of megabytes to every serverless function for it.
 *
 * A service account is the right fit for Calendar here because the calendars
 * are shared *with* it — there is no user to send through a consent screen, and
 * no refresh token to keep alive. (Drive is different; see scripts/README.)
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const JWT_GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer";
/** Google caps assertions at an hour; renew a little early to avoid racing the edge. */
const TOKEN_LIFETIME_SEC = 3600;
const RENEW_MARGIN_MS = 60_000;

export type GoogleCredentials = { clientEmail: string; privateKey: string };

/**
 * Reads the service-account credentials from the environment. Returns null when
 * unset, which is what keeps every Google-touching path a no-op in local
 * development and on any deployment that hasn't been configured yet.
 */
export function getGoogleCredentials(): GoogleCredentials | null {
  const clientEmail = process.env.GOOGLE_SA_CLIENT_EMAIL?.trim();
  const rawKey = process.env.GOOGLE_SA_PRIVATE_KEY?.trim();
  if (!clientEmail || !rawKey) return null;
  // Env vars can't hold real newlines in most dashboards, so the PEM is stored
  // with literal \n sequences and unescaped here.
  const privateKey = rawKey.includes("\\n") ? rawKey.replace(/\\n/g, "\n") : rawKey;
  return { clientEmail, privateKey };
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

let cached: { token: string; expiresAtMs: number; scope: string } | null = null;

/**
 * A bearer token for `scope`, cached in module scope for the life of the
 * warm serverless instance so a burst of bookings costs one token exchange.
 */
export async function getGoogleAccessToken(scope: string): Promise<string | null> {
  const creds = getGoogleCredentials();
  if (!creds) return null;

  if (cached && cached.scope === scope && Date.now() < cached.expiresAtMs - RENEW_MARGIN_MS) {
    return cached.token;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: creds.clientEmail,
      scope,
      aud: TOKEN_URL,
      iat: nowSec,
      exp: nowSec + TOKEN_LIFETIME_SEC,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const assertion = `${header}.${claims}.${base64url(signer.sign(creds.privateKey))}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: JWT_GRANT, assertion }),
  });
  if (!res.ok) {
    throw new Error(`Google token exchange failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cached = {
    token: json.access_token,
    expiresAtMs: Date.now() + json.expires_in * 1000,
    scope,
  };
  return cached.token;
}
