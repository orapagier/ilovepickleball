# Agent read API

A read-only HTTP API under `/api/agent/*` for connecting an external AI agent to
the booking system. It answers the operational questions — what's free, what's
booked, what's waiting on the admin, what got cancelled — without giving the
caller a session or any ability to write.

## Auth

Every request needs the static key from the `AGENT_API_KEY` environment variable:

```
Authorization: Bearer <AGENT_API_KEY>
```

`x-api-key: <AGENT_API_KEY>` is accepted too, for agent frameworks that can only
set a plain header.

With no `AGENT_API_KEY` set the API returns `503` — it fails closed, so a missing
env var can't accidentally publish every booking. Rotate the key by replacing the
value (in `.env` locally, in Vercel's project settings for the deployment) and
redeploying.

Responses are always `cache-control: no-store`.

## Conventions

- **Times**: every instant carries a UTC ISO string (`startUtc`) *and* a
  business-local label (`startLocal`, `time`, `date`), so a model never has to do
  timezone math. The business timezone is `Asia/Manila` unless changed in admin
  settings; every endpoint echoes it back as `timezone`.
- **Money**: integer `...Cents` fields, plus a preformatted `...Formatted` string.
- **Dates in query params**: `YYYY-MM-DD`, interpreted as business-local calendar days.

## Endpoints

### `GET /api/agent`

Self-describing index of the API — every endpoint and its parameters. Point an
agent here first if you want it to discover the rest at runtime.

### `GET /api/agent/config`

Business details, courts, opening hours (with a human summary and the weekly
closure), price tiers, payment channels, upcoming closures, and the booking rules
(slot length, max hours, lead time, hold time). Static enough to fetch once per
conversation and reuse.

### `GET /api/agent/availability`

| Param | Default | Meaning |
| --- | --- | --- |
| `date` | today | business-local start date |
| `days` | `1` | days to cover, max 14 |
| `courtId` | all active courts | restrict to one court |
| `onlyAvailable` | `false` | `true` drops taken/past slots from `slots` |

Per court, per day: every slot with a `status` of `available`, `confirmed`
(booked and paid), `pending` (held or awaiting verification — not bookable), or
`past` (elapsed, or inside the lead-time window). Each day also carries
`openRanges` — contiguous free blocks like `"10 AM – 10 PM"` — which is usually
what you want an agent to read out rather than 14 individual slots.

### `GET /api/agent/bookings`

| Param | Default | Meaning |
| --- | --- | --- |
| `status` | `all` | comma-separated; aliases below |
| `from` | today | inclusive start date, filters on booking start |
| `to` | `from` + 13 days | inclusive end date |
| `courtId` | all | restrict to one court |
| `limit` | `100` | 1–200 |
| `contact` | `false` | `true` includes customer email and phone |

Status aliases: `booked`/`confirmed`, `pending` (= `awaiting_confirmation` +
`awaiting_call`, i.e. the admin queue), `unpaid` (= `pending_payment`),
`cancelled`, `expired`, `active` (everything holding a slot), `all`, plus each
raw status name.

`totalMatching` and `truncated` tell you whether `limit` cut the list off, so an
agent doesn't under-report a count.

**Privacy**: customer email, phone, and full name are withheld by default — a
booking carries only `{ id, firstName }`. Pass `contact=true` per request when
the agent genuinely needs to reach someone.

### `GET /api/agent/summary`

Today (or `?date=`) at a glance in one call: bookings by status, confirmed
revenue, per-court occupancy and open ranges, each court's next free slot within
7 days, and everything still waiting on the admin (`needsAction`).

## Examples

```bash
curl -H "Authorization: Bearer $AGENT_API_KEY" \
  "https://<your-domain>/api/agent/summary"

# What's free on court 1 over the next three days?
curl -H "Authorization: Bearer $AGENT_API_KEY" \
  "https://<your-domain>/api/agent/availability?courtId=1&days=3&onlyAvailable=true"

# Everything awaiting confirmation, whenever it is
curl -H "Authorization: Bearer $AGENT_API_KEY" \
  "https://<your-domain>/api/agent/bookings?status=pending&from=2026-01-01&to=2027-01-01"
```

## Notes

- Reads run the same lazy expiry sweep the rest of the app uses, so a lapsed hold
  is never reported as still pending.
- Nothing here mutates state. Confirming or cancelling a booking from an agent
  would need a separate, explicitly gated write path.
