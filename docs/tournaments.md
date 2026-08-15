# Tournaments

Admin-run tournaments on top of the existing booking system. Admins own one end
to end — configuration, draw, court assignment, results, cancellation — and any
signed-in member can browse and enter.

This file records what was actually built and where it lives.

## Where the code is

| Concern | File |
|---|---|
| Rules with no database in them — bracket shape, the draw, the queue, edit rules, standings | `src/lib/tournament.ts` |
| The database-touching orchestration — draw generation, court queue, court blocks, the sweep | `src/lib/tournament-engine.ts` |
| Reads for the pages | `src/lib/tournament-data.ts` |
| Mutations | `src/lib/actions/tournament-actions.ts` |
| Member pages | `src/app/tournaments/` |
| Admin pages | `src/app/admin/tournaments/` |
| Components | `src/components/tournament/` |

The split between the first two files is deliberate: everything that is easy to
get subtly wrong (bye placement, who is allowed to play next, sort order of a
standings table) is a pure function that can be reasoned about and tested on its
own.

## Data model

`Tournament`, `TournamentCourt`, `Registration`, `Match` — see
`prisma/schema.prisma`. Two points worth knowing:

- **`TournamentCourt` is a join table**, not an array column, so a tournament's
  courts are real foreign keys like every other court reference in the schema.
- **`Match.nextMatchId` / `nextMatchSlot`** wire an elimination bracket so
  winners advance without the bracket shape being hardcoded anywhere. They are
  null for a round robin and for a final.
- **`Match.loserNextMatchId` / `loserNextMatchSlot`** are the same thing for the
  loser, which only double elimination uses. `Match.bracket` says which half of
  such a draw a match is in; `Match.pool` and `Registration.pool` say which pool,
  for a pool stage. All are null in the formats that don't have them.

One `Registration` is one *entry*: a pair in doubles, a single player in singles.

## Formats

Five, for an 8-entry field on two courts:

| Format | Matches | Shape |
|---|---|---|
| Single elimination | 7 | One loss and you're out. |
| Double elimination | 14–15 | Two losses. Winners bracket, losers bracket, grand final. |
| Round robin | 28 | Everybody plays everybody. |
| Pools into knockout | ~15 | Round-robin pools, then the top of each into a bracket. |
| Swiss | 12 | Three rounds paired by record; nobody is eliminated. |

With two courts the total match count is the binding constraint, and it is what
separates these. Round robin is `entries × (entries − 1) / 2`, which is why it is
capped at `MAX_ROUND_ROBIN_ENTRIES` (8 entries = 28 matches, already a full day
on two courts) — the cap is enforced in `readTournamentForm`, and the form
explains it before an admin hits it. Pools exist to give a field too big for one
round robin the same "everybody plays several matches" feel without the match
count, which is why each pool is capped at `MAX_POOL_SIZE` instead. Swiss is the
one whose length barely moves with the field: rounds are fixed, so twenty entries
take the same three or five rounds that eight do.

Each format's `PlannedMatch[]` comes from its own builder and nothing downstream
knows which one ran. Adding a sixth is a new builder plus a line in
`buildDrawPlan`.

### Shape knobs

`poolCount`, `advancePerPool` and `swissRounds` sit on `Tournament`, nullable.
Null means "whatever suits this field size", resolved in one place by
`resolveFormatConfig` — so an admin never has to have an opinion, and the
defaults can change without touching any stored row. They lock at
`registration_open` alongside `format`, under the `formatShape` edit rule: they
decide the shape of the draw, not how long it takes.

### Double elimination

The winners bracket is an ordinary single-elimination draw. Every match also
drops its loser into the losers bracket, which alternates *minor* rounds
(losers-bracket survivors against each other) with *major* rounds (those winners
against the entries that just dropped out of the winners bracket). That
alternation is what keeps the two brackets the same length.

The winners-bracket entries arriving in a major round are taken in **reverse
order**. Without that, an entry could meet the very opponent that put it there in
its first losers-bracket match.

The grand final is **twice to beat**, which is both the international bracket
reset and what the format is called locally. The winners-bracket champion
arrives unbeaten, so if they lose the grand final the two are level at one loss
each and a reset match decides it. The reset is planned like any other match and
walked over when it isn't needed, which is why the bracket view hides a reset
that has only one side.

`Match` needed a second edge out for this: `loserNextMatchId` /
`loserNextMatchSlot`. One match feeding two others is exactly what a single
`nextMatchId` cannot express. `refreshMatchStates` counts **both** kinds of
feeder when deciding whether a slot can still be filled — miss the loser feeders
and a losers-bracket match resolves as a bye while the entry due to drop into it
is still on court.

A walkover drops nobody. An entry that didn't turn up doesn't get a second life,
and leaving the slot empty lets their would-be opponent through as a bye, which
is the same result with less fiction in it.

### Pools into knockout

Entries are snaked across the pools (`assignPools`) so the draw order is spread
rather than stacked, each pool plays a circle-method round robin, and every
pool's round *n* is round *n* of the tournament — the pools run alongside each
other, not one after another.

Qualifiers are seeded into the knockout by `seedPoolQualifiers`. Seeding by
`bracketSeedOrder` keeps the pool winners apart but does **not**, on its own,
stop two entries from the same pool meeting in the opening match: whether it
does depends on the pool count and the number of byes, and no single ordering
gets it right for every shape. So it seeds and then repairs, swapping out any
pool-mate opener and preferring a swap between equal finishers so the seeding
stays as true as it can. Avoiding that rematch is the entire point of having
played the pools.

### Swiss

Round one is the shuffled field paired straight down. Every later round is
paired on the standings, nearest legal opponent first — entries on the same
record play each other, which is what makes it Swiss.

The pairing **backtracks**. Taking the closest legal opponent at every step can
strand the last two entries as a pair that has already met even when a
rematch-free pairing of the whole round exists; a six-entry draw hits it by the
third round. `pairSwissRound` tries the next-closest opponent instead, so the
pairing it settles on is the closest one that *works*.

An odd field byes whoever is currently last, and the bye is a real win — which
is why `buildStandings` counts a one-sided match rather than skipping it.

## Draws that grow

Most formats are planned in full at the draw. Two can't be:

- a **pool knockout** is drawn from the pool tables, which don't exist until the
  pools are played;
- a **Swiss** round is paired on the standings, so round *n+1* can't be written
  until round *n* is in.

`growDraw` adds those matches when the stage they wait on completes. It runs
inside `settleAfterMatch`, before `refreshMatchStates` and `completeIfFinished` —
get that order wrong and a tournament declares itself finished the moment its
pools end. It also runs in the sweep, so a process dying between the last pool
match and the knockout being drawn heals itself rather than leaving a tournament
finished-but-not-finished.

It is idempotent by construction: nothing fires until its stage is complete, and
once the next stage exists the stage-complete test is false.

Swiss resolves its round count against the field that **started**, not the
survivors — otherwise one withdrawal shortens the tournament under everybody
still playing.

## Lifecycle

```
draft ──publish──▶ registration_open ──close──▶ registration_closed ──start──▶ in_progress ──▶ completed
  │                      │                            │                            │
  └──────────────────────┴──────────── cancel ────────┴────────────────────────────┘
```

What each status still lets an admin edit lives in `EDITABLE_BY_STATUS`. The
form reads that table to decide which fields to lock, and `saveTournament` reads
the *same* table to reject a change that got past the form — a server action is
reachable by a direct POST, so the UI is never the enforcement.

Three rules the table can't express are checked separately in the action:

- The close date can be extended, never shortened by editing.
- `maxEntries` can be raised, never dropped below the count already registered.
- A fee change applies to new registrants only, never retroactively.

## Closing registration and the draw

`closeRegistrationAndDraw` (`tournament-engine.ts`):

1. Below `minEntries` → the tournament cancels, every entry is withdrawn, and
   any `feePaid` entry goes through the refund hook. Stop.
2. Otherwise entries are shuffled (v1 seeds at random; `shuffle` takes an
   injectable random source, so seeding by skill rating later is a one-argument
   change) and numbered.
3. Matches are created in two passes — all rows first, then `nextMatchId` wiring,
   because a match can't point at a row that doesn't exist yet.
4. Byes auto-complete as walkovers, advancing the real entry without a court
   ever being used.
5. Anything with both sides known becomes `ready` and joins the queue.

Single elimination pads to the next power of two using the standard bracket seed
order, which puts the byes on the top seeds and keeps seeds 1 and 2 apart until
the final. Round robin uses the circle method so the same entry isn't queued
back to back more than the draw forces. The other three formats are described
under [Formats](#formats) above.

Step 3 writes both the winner edge and the loser edge, and step 5 is what makes
a bye a walkover in any of them.

Rounds are numbered by **dependency depth** rather than by position in a
bracket: a match's round is one past the last round it depends on. That is what
makes a round mean "the matches that can be played once everything before them
is done", which is the property the day-length estimate counts in and the
property an admin schedules a window on. It matters most in double elimination,
where the losers bracket interleaves with the winners bracket and no positional
numbering would have that property. See `layoutPlan`.

## The two-court engine

At most two matches are ever live. The whole running order is one rule, applied
whenever a court frees up (`planCourtAssignments`):

> Take the earliest queued match whose entries aren't already on the other court.

The eligibility check matters for round robin, where one entry appears in many
matches. An elimination bracket can't produce the clash by construction.

This is deliberately a live queue rather than a pre-computed timetable — real
match lengths vary too much to schedule two courts in advance. Recording a
result is the only thing staff do; the freed court refills itself.
`estimatedEndAt` exists **only** to size the calendar block and never governs
the running order.

The estimate follows the draw's **critical path**, not an average. Dividing
total matches by court count is the tempting answer and it is wrong: a bracket
round can't start until the round feeding it finishes, so the closing rounds run
one or two matches with the other court idle. An 8-draw is 7 matches, which
looks like 3.5 court-hours across two courts, but it is really 4 waves — 4, then
2, then 1. See `playWaves`; getting this wrong under-books a 20-draw by a full
hour.

Staff can override the queue from the run-day view and send a specific match to
a specific court.

## Scheduling: windows of play

By default a tournament is one continuous block and the queue above runs the
whole thing. Add **sessions** — named windows like "Round 1, Monday 8–10am" —
and play is confined to them instead. That is what lets a tournament span
several mornings or several days.

A session holds *matches*, not times for individual matches. Inside a window the
live queue still calls whoever is up as courts free, for the same reason it
always did. A window says which day and which hours; it does not say 11:07.

**Rounds are the scheduling unit** because within one round nobody plays twice —
that is exactly the property that lets a round fit in a window. This is why
`buildRoundRobinPlan` numbers its rounds by circle turn rather than putting
every match in round 1: without real rounds, "round 1 is Monday" is not a
statement you can make about a round robin.

Rules the engine enforces:

- A scheduled match is only called inside its own window (`assignFreeCourts`).
- An **unscheduled** match (`sessionId` null, or a tournament with no sessions)
  is callable whenever the tournament is running — so the original behaviour is
  what you get until somebody builds a schedule.
- Windows may not overlap; two open windows would double-block the same courts.
- Deleting a window unschedules its matches, never deletes them.
- Matches already played keep the window they were in — rewriting that to match
  a schedule change would misreport when they happened.
- An admin can always force any match onto a court by hand from the run-day view,
  window or no window.

A window opening is a thing that happens on a clock, not in response to a
result, so nothing else would notice it. `sweepTournaments` re-runs the court
assignment for every live tournament, which is what puts Monday's round on court
at 8am without anyone pressing a button.

## Pacing, and overriding it

Block length comes from `Setting.averageMatchMinutes` and
`courtChangeoverMinutes`, either of which a tournament can override
(`resolvePacing` — tournament, then facility, then the constants). Blank means
inherit; zero means zero.

These only size the court block. They never drive the running order.

## Court blocks on the booking calendar

Publishing a tournament holds its courts by creating ordinary `Booking` rows
tagged with `tournamentId`, from `startAt` to `estimatedEndAt`. They are normal
bookings on purpose: every availability check, the admin views, and the Google
Calendar mirror already understand those, so nothing else had to learn about
tournaments.

The blocks are owned by the admin who published, but `getBusyIntervalsWithStatus`
prefers the tournament's name, so the booking grid says *Booked — Summer Doubles
Open* rather than naming the admin.

`syncCourtBlocks` is re-runnable: it drops and rebuilds, which is what a change
to `startAt` or the court list needs. Cancelling or finishing a tournament
releases the blocks (cancelled, never deleted, so the calendar mirror is told to
drop their events).

## The sweep

This deployment has no long-running process to hang a cron job on, so deadlines
are lazy and self-healing, exactly like `reapExpiredBookings` on the booking
side. `sweepTournaments` runs at the top of every tournament read and:

- closes registration (drawing the bracket, or cancelling a short draw) for
  anything past `registrationClosesAt`;
- flips `registration_closed` → `in_progress` at `startAt` and fills the courts.

Both paths are guarded so a sweep and an admin clicking the same button at the
same moment can't draw twice.

## Notifications

The booking system has no email or push channel to reuse — booking
communication is entirely in-app plus the Google Calendar mirror — so the
tournament notifications from the plan are in-app too:

- **"You're up — Court 1"** on `/tournaments` and on the tournament page, shown
  the moment a member's match is assigned a court.
- Entry confirmation, waitlist position, and cancellation are the state of the
  join panel.

If an email or push channel is added later, `settleAfterMatch` and
`assignFreeCourts` are the two places that know a match just changed hands.

## v1 assumptions

Carried over from the plan, all of them still true in the code:

- Five formats (see [Formats](#formats)). Ladder and box leagues are still out:
  both are ongoing rather than a day with a start and an end, so neither fits the
  lifecycle or the court blocks.
- Doubles partners are added directly at registration, by the email they sign in
  with — no invite/accept step, and no member directory exposed to do it.
- No participant self-reported scores; staff enter them.
- No pre-computed time slots.
- Refunds are the `refundEntryFee` hook. There is no online tournament payment
  flow — `feePaid` is a box staff tick — so the hook logs what is owed rather
  than reversing anything.
- Seeding is random.
- No drag-and-drop seeding UI.
