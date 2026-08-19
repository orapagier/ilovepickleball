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
| Proving all five formats end to end against the real engine | `scripts/simulate-tournaments.ts` |

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

The **day-length estimate subtracts the byes**, which in this format takes a
walk over the plan rather than arithmetic. Padding to a power of two creates
winners-bracket matches with one entry in them, and those byes cascade: the
losers-bracket match fed by two of them has nobody to put in it either. None of
them ever takes a court. `contestedMatches` replays the fill rule the engine
uses — a slot is filled if the match feeding it produces somebody, any match
with somebody in it produces a winner, and only a contested match produces a
loser — so `matchesPerRound` counts what will be played. Before that it counted
plan rows, and a 5-entry draw was booked for exactly as long as a full 8-entry
one.

The grand final reset is the deliberate exception: it is counted whether or not
this particular plan fills its second side, because it is walked over only when
the winners-bracket champion wins outright, and the block has to be long enough
for the day it isn't.

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

## Skill levels

A member carries one `User.skillRating` on the 2.0–5.5 half-step scale; a
tournament carries `minSkillRating`/`maxSkillRating`. Entry is refused unless
the rating sits inside the band — for **every** player in the entry, since a
doubles pair enters as one row and an out-of-band partner is an out-of-band
entry.

The band is stored as the bounds and **nothing else**. The text on the browse
card, the tournament page, the admin form and the CSV all come from
`formatSkillBand`, so what a member reads and what `canEnterAtRating` enforces
are the same fact. The earlier free-text `skillLevel` label could say "3.5-4.0"
while admitting anybody, which is exactly the failure this shape rules out.

An **unrated** member is refused from a banded tournament rather than waved
through. The point of a band is that everyone in the draw is known to belong in
it, and "no rating" is not evidence of that. The refusal is a dead end for about
ten seconds — the join panel links straight to the profile form.

A member the band excludes **never sees the enter form at all**. The tournament
page computes the verdict with `canEnterAtRating` and passes a `SkillBlock` to
`JoinPanel`, which renders a notice in the form's place: "set your level" when
unrated (the member almost certainly qualifies), and a plain refusal naming the
band and their rating when they don't. The refusal offers no control that looks
like one, because it isn't fixable by the member — the rating is self-declared,
so the honest next step is the desk.

This is about money, not tidiness. The entry fee is paid by hand before anything
in the app confirms the entry, so a member who can be refused *after* filling in
a payment reference is a member who can pay for a tournament they cannot enter.

A doubles **partner** is still only checked server-side. They are identified by
an email typed into the form, so there is nothing to check until it is
submitted — `checkSkillBand` covers every player in the entry.

Ratings are self-declared, and an admin can correct one from the member's page
(`adminSetSkillRating`). Correcting a rating is deliberately **not**
retroactive: an entry already in a draw stays in it. Pulling somebody out of a
bracket is an admin withdrawal, with consequences for the draw, not a side
effect of editing a profile field.

Setting a rating is optional and is *not* part of `ProfileCompletion.complete`,
which gates booking a court — a pickleball rating has nothing to do with
booking one, and blocking that would tax people who only ever want to play.

A member sets their own from **`/profile`**, linked in the header whenever
somebody is signed in. That page exists because `/register` cannot serve the
purpose: `/register` is the gate before a first booking and redirects away the
moment the profile is complete, so it is only ever seen by someone being
stopped. A rating is changed long after that, usually on the way to entering a
tournament. `/register` still offers the field — a member is already filling in
a form — but `/profile` is where it lives.

Both use `SkillLevelPicker`, which shows the matrix row for the level being
considered (what a player at it can do, and what it is ready to enter) rather
than only the number. The rating is a self-assessment, and nobody can tell a 3.0
from a 3.5 by the digits.

The browse filter asks "what can I enter at this rating" rather than listing
bands, because that is the question a member actually has.

## Entry fees

A tournament that charges requires a **payment reference** before the entry is
listed — `Registration.paymentReference`, free text, capped at 60 characters.

It is deliberately not a validated transaction id. The desk takes cash and bank
transfers as well as e-wallets, so a mobile number is a perfectly good answer;
what matters is that staff are never left with an entry and no way to chase it.
Nothing about it verifies payment — `feePaid` is still the staff tick, and the
admin entry list shows the reference until that tick happens.

The join form shows the club's configured payee accounts (GCash / BDO / QRPh,
from settings) right above the field, and only the ones actually filled in — an
empty account rendered as a payee reads as an instruction to send money nowhere.
Asking for a reference without saying where to pay is the one arrangement that
guarantees a wrong answer.

**Order matters in `joinTournament`:** the skill band is checked *before* the
payment reference. The fee is settled by hand, outside the app, so a refusal
that arrives after the reference field is a refusal that arrives after the
money. For the same reason the tournament page decides the entrant's own skill
verdict server-side and renders a notice **instead of** the enter form — see
below.

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

### Where windows are set

Windows can be added **on the create form**, before the tournament exists. A
tournament that spans several mornings is that shape from the moment it is
conceived, and an admin who has to save first and schedule second has to
remember to come back — the window they meant is the detail most likely to be
forgotten. Rows post as parallel `sessionName`/`sessionStartAt`/`sessionEndAt`
fields, validated in `readTournamentForm` against the same rules `saveSession`
applies (named, ending after they start, non-overlapping) and created with the
tournament. Adding none stays the normal case: one continuous block.

Once the tournament exists, windows are edited only through the `ScheduleEditor`
on its own page. That is not duplication with different clothes — by then a
window holds matches, so removing one unschedules them, and each edit is worth
its own action that can weigh that. Assigning rounds to windows likewise waits
for a draw to exist.

A draft blocks no courts, so creating windows with a draft does not call
`syncCourtBlocks`; `publishTournament` does, which is what puts them on the
calendar.

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

## Who finished where

Nothing stores a final table. The draw is the only record of the result, so
`finalPlacements` reads it back — the same matches the results view renders —
and states the order they imply. Each format is asked the question it can
actually answer:

- **Single elimination** ranks by how far an entry got: everyone knocked out in
  the same round finished level, and whoever was never knocked out won. Reading
  rounds rather than bracket positions is what makes a draw padded with byes come
  out right — an entry that had a bye and went out in round 2 got further than
  one that played and lost in round 1.
- **Double elimination** takes the top two off the grand final. The reset's
  winner is the champion either way, since it is walked over when the
  winners-bracket champion wins outright; the runner-up is the loser of whichever
  of the two was actually contested. Everybody else went out of the losers
  bracket, and the later they went the further they got — which makes the losers
  final's loser third without a play-off.
- **Round robin and Swiss** take the standings order, with `buildStandings`'s
  existing tiebreaks and no others.
- **Pools into knockout** places the qualifiers off the knockout, then the rest
  by where they finished in their pool.

Ties are stated rather than broken. A single-elimination bracket genuinely cannot
separate its two semifinal losers — there is no third-place match — and two
identical standings rows are level in fact, not merely adjacent in the sort. Both
come back marked `tied`, sharing a place, with the next distinct place past all
of them: 1, 2, 3, 3, 5. Inventing an order for either would report a result that
was never played.

## Prizes

`TournamentPrize` is one row per place — `place`, `label`, `amountCents`,
`description` — rather than one blob on the tournament. A placing is a thing the
draw produces, so what third place is *worth* can be attached to whoever finished
third; a paragraph could only ever be printed next to the results.

`prizeDescription` survives as the extra-notes field, for what doesn't belong to
any one placing ("trophies for every finalist", where to collect) and for
whatever was written before places existed.

The place is the identity: it is what `withPrizes` pairs against, so a repeated
place is rejected in `readTournamentForm` and the table is replaced wholesale on
save rather than reconciled row by row. A blank amount is **not** zero — zero
advertises a cash prize of nothing, blank means the prize isn't money.

The table edits under `prizes` in `EDITABLE_BY_STATUS`, and stays open all the
way to `registration_closed`: what a tournament pays is advertised, not promised
under contract, and a club that lands a sponsor the week before should be able to
say so.

## Reading the results without opening a tournament

`/tournaments` carries a compact card under every tournament that has anything to
show, and `/` carries a promo tile for what is live and what is open.

The cards are built out of the same `StandingsTable` and the same
`finalPlacements` the tournament's own page uses, so the glance and the page
cannot disagree. Which card appears depends on what the format actually has:

- a table for round robin, Swiss and a pool stage, because that is the answer;
- **bracket progress** for single elimination, double elimination and a pool
  knockout — the round in play, who is still in, who is out, and what is on court
  — because an entry's win-loss record in a knockout says almost nothing, since
  who you played is the whole story;
- a **winners card** once it is over: champion, runner-up and third, each against
  the prize sitting at their place.

Both pages fetch flat. `listTournamentResults` takes every tournament id on the
page and returns three grouped queries for all of them, rather than a relation
include that would drag every match of every tournament ever run through a page
that mostly wants names and dates. `getTournamentPromo` is one query plus two
`groupBy` aggregates, and deliberately does **not** sweep: the sweep draws
brackets and starts play, which is real work to hang off the homepage, and its
`where` clauses ask the same questions `isJoinable` does, so a tournament whose
deadline has gone is filtered out whether or not anything has closed it yet.

## Proving it

`scripts/simulate-tournaments.ts` runs one tournament of every format from an
empty draft to a champion against the real database, through the real engine
calls — `closeRegistrationAndDraw`, `assignFreeCourts`, `settleAfterMatch`,
`growDraw`, `completeIfFinished`. It writes no `Match` row by hand, because a
bracket the script drew itself would only prove that the script agrees with
itself.

    npx tsx --env-file=.env.local scripts/simulate-tournaments.ts

The field sizes are awkward on purpose — powers of two are the case every format
gets right. Eleven into a sixteen draw for the byes, the round-robin cap itself,
six into a double elimination with the grand final forced to a reset, eleven
across three pools that come out 3/4/4, and an odd Swiss field that byes somebody
every round. Each one takes a waitlist promotion and a withdrawal on the way in.

What it then asserts is a property of *any* run rather than of one draw: that the
tournament completed and stamped `completedAt`, that no match was left unplayed,
that the matches played match `totalMatchCount`, that walkovers hold no court,
that `played = wins + losses` in every standings row, that the placement list
covers the field exactly once and reads as a competition ranking, that the
champion it names is the one the draw names read a different way, and that the
court blocks went back to the calendar.

`scripts/cleanup-simulated-tournaments.ts` removes everything it made. Both are
scoped to the `[SIM]` name tag and the `sim-` member prefix, because
`DATABASE_URL` is a shared development database.

## Deleting a tournament

`tournamentDeletability` decides, and `deleteTournament` enforces:

- **Cancelled** — deletable straight away. Nothing was played, so there is no
  record to keep.
- **Completed** — deletable once `COMPLETED_RETENTION_DAYS` (30) have passed
  since it finished. Results are worth keeping while anyone might still be
  asking about them.
- **Anything else** — refused. A tournament with play still ahead of it or
  under way is cancelled first; deleting one out from under its entrants is
  never the intended move.

Finished tournaments from before `completedAt` existed fall back to
`updatedAt`, which for a completed tournament is the status write itself.

The delete cascades to entries, matches and windows through the schema, but
**not** to the court blocks: `Booking.tournamentId` is `ON DELETE SET NULL`, so
they would survive as orphaned bookings owned by whichever admin published.
`deleteTournament` removes them explicitly first. They carry no payment and no
customer intent — they exist only so availability checks can see them.

There is no soft delete and no undo, which is why the admin view points at the
CSV export in the same breath, and why the button appears only when the delete
would actually succeed. A completed tournament still inside its window shows
how long is left instead of a button that could only say no.

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
- Skill ratings are self-declared, with staff able to correct one. Nothing
  verifies them against results played.
- No participant self-reported scores; staff enter them.
- No pre-computed time slots.
- Refunds are the `refundEntryFee` hook. There is no online tournament payment
  flow — an entrant supplies a reference and `feePaid` is a box staff tick — so
  the hook logs what is owed rather than reversing anything.
- Seeding is random.
- No drag-and-drop seeding UI.
