#!/usr/bin/env node
/**
 * One-time helper: mints the Google Drive refresh token the nightly backup
 * workflow uses. Run it once on your own machine, paste the printed token into
 * a GitHub secret, and never run it again.
 *
 *   node scripts/google-drive-auth.mjs
 *
 * Why a user token rather than the service account the calendar sync uses:
 * a service account gets no Drive storage of its own on a consumer Google
 * account, so anything it uploads into a shared folder fails with a quota
 * error. Backups therefore run as *you*, using the `drive.file` scope — which
 * grants access only to files this app itself creates, not your whole Drive.
 */

import http from "node:http";
import crypto from "node:crypto";

const SCOPE = "https://www.googleapis.com/auth/drive.file";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();

if (!clientId || !clientSecret) {
  console.error(
    [
      "Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET first.",
      "",
      "Create them at https://console.cloud.google.com/apis/credentials",
      '  → Create credentials → OAuth client ID → Application type "Desktop app"',
      "",
      "PowerShell:",
      '  $env:GOOGLE_OAUTH_CLIENT_ID = "…apps.googleusercontent.com"',
      '  $env:GOOGLE_OAUTH_CLIENT_SECRET = "…"',
      "  node scripts/google-drive-auth.mjs",
    ].join("\n"),
  );
  process.exit(1);
}

const base64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const verifier = base64url(crypto.randomBytes(32));
const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
const state = base64url(crypto.randomBytes(16));

const server = http.createServer();
server.listen(0, "127.0.0.1", () => {
  const redirectUri = `http://127.0.0.1:${server.address().port}`;
  const url = `${AUTH_URL}?${new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    // Both are required to be handed a refresh token: offline access asks for
    // one, and forcing the consent screen re-issues it on repeat runs.
    access_type: "offline",
    prompt: "consent",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  })}`;

  console.log("\nOpen this URL, sign in as the account that should own the backups:\n");
  console.log(url);
  console.log("\nWaiting for the redirect…");

  server.on("request", async (req, res) => {
    const params = new URL(req.url, redirectUri).searchParams;
    const finish = (msg) => {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end(msg);
      server.close();
    };
    if (params.get("error")) return finish(`Authorisation failed: ${params.get("error")}`);
    const code = params.get("code");
    if (!code) return;
    if (params.get("state") !== state) return finish("State mismatch — start over.");

    const tokenRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code_verifier: verifier,
      }),
    });
    const json = await tokenRes.json();
    if (!tokenRes.ok || !json.refresh_token) {
      finish("Token exchange failed — see the terminal.");
      console.error("\nFailed:", JSON.stringify(json, null, 2));
      console.error(
        "\nNo refresh_token usually means this account has already granted the app." +
          "\nRevoke it at https://myaccount.google.com/permissions and run this again.",
      );
      process.exit(1);
    }
    finish("Done — you can close this tab and return to the terminal.");
    console.log("\n✔ Refresh token (store as the GOOGLE_OAUTH_REFRESH_TOKEN GitHub secret):\n");
    console.log(json.refresh_token);
    console.log(
      "\nAlso set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET as secrets." +
        "\nPublish the OAuth app (Production) in the Google console — apps left in" +
        "\nTesting have their refresh tokens expire after 7 days. drive.file is a" +
        "\nnon-sensitive scope, so publishing needs no Google review.\n",
    );
  });
});
