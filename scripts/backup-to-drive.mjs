#!/usr/bin/env node
/**
 * Uploads a database dump to Google Drive and prunes old ones.
 *
 *   node scripts/backup-to-drive.mjs <file>
 *
 * Runs from the nightly GitHub Actions workflow, but works locally too given
 * the same three env vars. Uses the `drive.file` scope, so it can only see and
 * touch files it created itself — including the backup folder. That is also
 * why pruning is safe: nothing else in the Drive is even visible to it.
 */

import fs from "node:fs";
import path from "node:path";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const FILES_API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";

const FOLDER_NAME = process.env.BACKUP_FOLDER_NAME?.trim() || "Smash Zone DB Backups";
const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS || 30);

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: node scripts/backup-to-drive.mjs <file>");
  process.exit(1);
}
if (!fs.existsSync(filePath)) {
  console.error(`No such file: ${filePath}`);
  process.exit(1);
}

const clientId = required("GOOGLE_OAUTH_CLIENT_ID");
const clientSecret = required("GOOGLE_OAUTH_CLIENT_SECRET");
const refreshToken = required("GOOGLE_OAUTH_REFRESH_TOKEN");

function required(name) {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`Missing ${name}. See docs/backups-and-calendar.md.`);
    process.exit(1);
  }
  return v;
}

async function accessToken() {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const json = await res.json();
  if (!res.ok) {
    // invalid_grant here almost always means the OAuth app is still in
    // "Testing", where Google expires refresh tokens after seven days.
    throw new Error(`Token refresh failed (${res.status}): ${JSON.stringify(json)}`);
  }
  return json.access_token;
}

async function api(token, url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`${init.method || "GET"} ${url} failed (${res.status}): ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

/** The backup folder, created on first run. */
async function ensureFolder(token) {
  const q = `name = '${FOLDER_NAME.replace(/'/g, "\\'")}' and mimeType = '${FOLDER_MIME}' and trashed = false`;
  const found = await api(token, `${FILES_API}?${new URLSearchParams({ q, fields: "files(id,name)" })}`);
  if (found.files?.length) return found.files[0].id;

  const created = await api(token, FILES_API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }),
  });
  console.log(`Created Drive folder "${FOLDER_NAME}" (${created.id})`);
  return created.id;
}

async function upload(token, folderId) {
  const name = path.basename(filePath);
  const metadata = { name, parents: [folderId] };
  const boundary = `sz${Date.now().toString(36)}`;
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\ncontent-type: application/gzip\r\n\r\n`,
    ),
    fs.readFileSync(filePath),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const res = await api(token, `${UPLOAD_API}?uploadType=multipart&fields=id,name,size`, {
    method: "POST",
    headers: { "content-type": `multipart/related; boundary=${boundary}` },
    body,
  });
  console.log(`Uploaded ${res.name} (${res.size} bytes) to "${FOLDER_NAME}"`);
}

async function prune(token, folderId) {
  if (!Number.isFinite(RETENTION_DAYS) || RETENTION_DAYS <= 0) return;
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
  const q = `'${folderId}' in parents and trashed = false and createdTime < '${cutoff}'`;
  const old = await api(token, `${FILES_API}?${new URLSearchParams({ q, fields: "files(id,name,createdTime)" })}`);
  for (const f of old.files || []) {
    await api(token, `${FILES_API}/${f.id}`, { method: "DELETE" });
    console.log(`Pruned ${f.name} (created ${f.createdTime})`);
  }
  if (!old.files?.length) console.log(`Nothing older than ${RETENTION_DAYS} days to prune`);
}

const token = await accessToken();
const folderId = await ensureFolder(token);
await upload(token, folderId);
await prune(token, folderId);
