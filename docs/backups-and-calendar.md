# Backups and Google Calendar sync

Two independent features, both optional, both off until their secrets exist.

- **Backups** — a nightly GitHub Actions job dumps Neon and uploads to Google Drive.
- **Calendar sync** — the app mirrors bookings into one Google Calendar per court.

They use *different* Google auth on purpose. The reason is a Google constraint
worth knowing before you start: a **service account has no Drive storage of its
own** on a consumer (`@gmail.com`) account, so anything it uploads fails with a
quota error. Drive therefore runs as you, via OAuth. Calendar has no such limit,
so it uses a service account and skips the token dance entirely.

|          | Auth                     | Why                                          |
| -------- | ------------------------ | -------------------------------------------- |
| Drive    | OAuth refresh token      | Service accounts can't store files in a personal Drive |
| Calendar | Service account          | Calendars are shared *with* it; no token to renew |

---

## Part 1 — Nightly backups to Google Drive

### What it does

Every night at 01:00 Manila time, `.github/workflows/backup.yml` runs `pg_dump`
against Neon, gzips it, and uploads it to a **Smash Zone DB Backups** folder in
Drive. Dumps older than 30 days are deleted. The whole database is a few
megabytes, so each file is tiny.

The workflow uses the `drive.file` scope, which grants access **only to files
this app itself creates** — it cannot see the rest of your Drive. That is also
what makes the pruning step safe.

### Setup

1. **Google Cloud console** → create (or reuse) a project → **APIs & Services**
   → enable the **Google Drive API**.
2. **Credentials** → *Create credentials* → *OAuth client ID* → application type
   **Desktop app**. Note the client ID and secret.
3. **OAuth consent screen** → set the user type to External and **publish the
   app** (move it out of *Testing*). This matters: refresh tokens issued by an
   app in Testing **expire after 7 days** and your backups would silently stop.
   `drive.file` is a non-sensitive scope, so publishing requires no Google review.
4. Mint the refresh token locally:

   ```powershell
   $env:GOOGLE_OAUTH_CLIENT_ID = "…apps.googleusercontent.com"
   $env:GOOGLE_OAUTH_CLIENT_SECRET = "…"
   node scripts/google-drive-auth.mjs
   ```

   Open the printed URL, sign in as the account that should own the backups,
   and copy the refresh token it prints.

5. **GitHub repo** → Settings → Secrets and variables → Actions → add four
   repository secrets:

   | Secret | Value |
   | ------ | ----- |
   | `DATABASE_URL` | The Neon **unpooled** connection string (`DATABASE_URL_UNPOOLED` in `.env.local`) |
   | `GOOGLE_OAUTH_CLIENT_ID` | From step 2 |
   | `GOOGLE_OAUTH_CLIENT_SECRET` | From step 2 |
   | `GOOGLE_OAUTH_REFRESH_TOKEN` | From step 4 |

6. Run it once by hand: **Actions** → *Nightly database backup* → *Run workflow*.

Until those secrets exist the job skips itself rather than failing every night.

### Restoring

```bash
gunzip -c smash-zone-2026-08-12T170000Z.sql.gz | psql "$TARGET_DATABASE_URL"
```

Restore into a **fresh** database (or a Neon branch) first and look at it before
pointing the app at it. The dump uses `--no-owner --no-acl`, so it will load into
any Postgres 17, not just Neon.

### What this does and doesn't protect against

| Scenario | Covered? |
| -------- | -------- |
| Bad deploy, Vercel outage, Vercel project deleted | Not a data problem — Neon is untouched |
| Accidental `DELETE`, bad migration | **Yes**, up to 24h of loss — or use Neon's own restore window for finer recovery |
| Neon account lost, closed, or unpaid | **Yes** — the dumps live in Drive, outside Neon |
| Losing both your Google account and Neon | No. Download a dump occasionally if that worries you. |

Neon also keeps its own point-in-time history (Console → project → Branches →
Restore). That window is shorter but far more precise. Check what your plan
gives you *before* you need it.

---

## Part 2 — Google Calendar sync

### What it does

Each court mirrors into its own Google Calendar, so overlapping bookings on
different courts don't collide visually and each court gets its own colour.

- A **hold** (pending payment / awaiting call) appears immediately as a
  *tentative* event titled `PENDING — Jelmar Orapa (2h)`, in graphite.
- On confirmation it becomes a normal event, `Jelmar Orapa (2h)`.
- Cancelled, expired, and deleted bookings have their events removed.
- Rescheduling moves the event; changing court moves it to the other calendar.

The event description carries the customer's mobile, email, payment method,
reference number, note, and the booking id.

**It is a mirror, never a source of truth.** Editing an event in Google does not
change the booking, and your edit is overwritten the next time that booking
syncs. To block a court, use blackout dates or business hours in the admin.

### Setup

1. **Google Cloud console** → same project is fine → enable the **Google
   Calendar API**.
2. **Credentials** → *Create credentials* → **Service account**. Open it → *Keys*
   → *Add key* → **JSON**. The file contains `client_email` and `private_key`.
3. In **Google Calendar**, create one calendar per court (e.g. *Smash Zone Court 1*).
   For each: Settings → *Share with specific people* → add the service account's
   `client_email` with permission **Make changes to events**.
4. Still in each calendar's settings, copy the **Calendar ID** (looks like
   `…@group.calendar.google.com`).
5. Add two environment variables in **Vercel** (Production, and Preview if you
   want it there too):

   | Variable | Value |
   | -------- | ----- |
   | `GOOGLE_SA_CLIENT_EMAIL` | `client_email` from the JSON key |
   | `GOOGLE_SA_PRIVATE_KEY` | `private_key` from the JSON key, newlines as literal `\n` |

6. Redeploy, then go to **/admin/courts** — a *Google Calendar ID* field now
   appears on each court. Paste the matching ID and save.

Leave a court's field blank to stop mirroring just that court. Remove the two
environment variables to switch the whole feature off.

### Failure behaviour

Calendar sync can never block a booking. Every call is detached from the request
via `after()` and its errors are logged, not surfaced — a Google outage, an
expired key, or a calendar you forgot to share degrades to *the calendar is
stale*, never *customers can't book*.

Stale events clean themselves up: the expiry sweep that flips dead holds also
sweeps bookings whose event should no longer exist (`reconcileCalendar` in
`src/lib/google-calendar.ts`), so a failed delete is retried on the next pass.
