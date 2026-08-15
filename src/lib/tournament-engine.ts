import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/booking-data";
import { queueCalendarSync } from "@/lib/google-calendar";
import {
  assignPools,
  bracketFieldSize,
  buildDrawPlan,
  buildPoolKnockoutPlan,
  buildStandings,
  drawGrows,
  estimateEndAt,
  MIN_TOURNAMENT_ENTRIES,
  pairKey,
  pairSwissRound,
  planCourtAssignments,
  resolveFormatConfig,
  resolvePacing,
  seedPoolQualifiers,
  shuffle,
  type Pacing,
  type PlannedMatch,
} from "@/lib/tournament";

/**
 * The database-touching half of running a tournament: turning a closed
 * registration list into a draw, keeping the two courts fed, advancing winners,
 * and holding the courts on the booking calendar. The rules these steps follow
 * live in `src/lib/tournament.ts`; this file only applies them.
 *
 * Everything here is written to be safely re-runnable. There is no ticking job
 * on this deployment (see `reapExpiredBookings` for the same constraint on the
 * booking side), so `sweepTournaments` is called from the tournament pages and
 * has to cope with being called twice at once, or not for an hour.
 */

/* ------------------------------------------------------------------ *
 * Court blocks on the booking calendar
 * ------------------------------------------------------------------ */

/**
 * Hold the tournament's courts for its whole window as ordinary Bookings, so
 * every existing availability check keeps members from booking over it. The
 * blocks are owned by the admin who published, and tagged with `tournamentId`
 * so the booking grid can name the tournament rather than that admin.
 *
 * Re-runnable: existing blocks are dropped and rebuilt, which is what an edit
 * to `startAt` or the court list needs.
 */
export async function syncCourtBlocks(tournamentId: string): Promise<void> {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: {
      courts: true,
      sessions: { orderBy: { startAt: "asc" } },
      _count: { select: { registrations: true } },
    },
  });
  if (!tournament) return;

  await releaseCourtBlocks(tournamentId);
  // A cancelled or finished tournament releases its courts and takes none back.
  if (tournament.status === "cancelled" || tournament.status === "completed") return;

  /* Two shapes of block. With sessions the admin has said exactly when play
     happens, so each window is held on its own and the hours between them go
     back to members — that's the point of scheduling across days. Without
     them it's one continuous block sized from the draw, as before. */
  const windows =
    tournament.sessions.length > 0
      ? tournament.sessions.map((s) => ({ start: s.startAt, end: s.endAt, label: s.name }))
      : [
          {
            start: tournament.startAt,
            end:
              tournament.estimatedEndAt ??
              estimateEndAt({
                startAt: tournament.startAt,
                format: tournament.format,
                entries: Math.max(tournament.maxEntries, tournament._count.registrations),
                courtCount: tournament.courts.length,
                pacing: await pacingFor(tournament),
                config: tournament,
              }),
            label: "",
          },
        ];

  for (const window of windows) {
    const hours = Math.max(1, Math.ceil((window.end.getTime() - window.start.getTime()) / 3_600_000));
    for (const { courtId } of tournament.courts) {
      const block = await prisma.booking.create({
        data: {
          courtId,
          customerId: tournament.createdById,
          startUtc: window.start,
          endUtc: window.end,
          hours,
          status: "confirmed",
          payMethod: "arranged",
          customerNote: window.label
            ? `Tournament: ${tournament.name} — ${window.label}`
            : `Tournament: ${tournament.name}`,
          tournamentId: tournament.id,
        },
      });
      queueCalendarSync(block.id);
    }
  }

  // Keep the headline end time honest: with sessions it's when the last window
  // closes, not an estimate of how long the draw would have taken.
  const lastEnd = windows[windows.length - 1]?.end ?? null;
  if (lastEnd && tournament.estimatedEndAt?.getTime() !== lastEnd.getTime()) {
    await prisma.tournament.update({ where: { id: tournamentId }, data: { estimatedEndAt: lastEnd } });
  }
}

/** This tournament's pacing figures — its own overrides, else the facility's. */
async function pacingFor(tournament: {
  averageMatchMinutes: number | null;
  courtChangeoverMinutes: number | null;
}): Promise<Pacing> {
  return resolvePacing(tournament, await getSettings());
}

/** Cancel (never delete) this tournament's blocks, so the calendar mirror is
 *  told to drop their events the same way a cancelled booking's is. */
export async function releaseCourtBlocks(tournamentId: string): Promise<void> {
  const existing = await prisma.booking.findMany({
    where: { tournamentId, status: { not: "cancelled" } },
    select: { id: true },
  });
  if (existing.length === 0) return;

  await prisma.booking.updateMany({
    where: { id: { in: existing.map((b) => b.id) } },
    data: { status: "cancelled" },
  });
  for (const { id } of existing) queueCalendarSync(id);
}

/* ------------------------------------------------------------------ *
 * Closing registration and generating the draw
 * ------------------------------------------------------------------ */

export type CloseOutcome =
  | { outcome: "skipped"; reason: string }
  | { outcome: "cancelled"; reason: string }
  | { outcome: "drawn"; matches: number; entries: number };

/**
 * Close registration and build the draw. Under `minEntries` the tournament
 * cancels instead, per §5.3 — every entry is withdrawn and any paid fee is sent
 * to the refund hook.
 */
export async function closeRegistrationAndDraw(tournamentId: string): Promise<CloseOutcome> {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: { courts: true },
  });
  if (!tournament) return { outcome: "skipped", reason: "Tournament not found." };
  // Guard the whole draw, not just the status write: the sweep and an admin's
  // "close early" can land on the same tournament at the same time, and drawing
  // twice would try to create a second set of matches.
  if (tournament.status !== "registration_open") {
    return { outcome: "skipped", reason: "Registration for this tournament is already closed." };
  }

  const entries = await prisma.registration.findMany({
    where: { tournamentId, status: "registered" },
    orderBy: { registeredAt: "asc" },
    select: { id: true },
  });

  if (entries.length < Math.max(tournament.minEntries, MIN_TOURNAMENT_ENTRIES)) {
    await cancelTournamentRecord(
      tournamentId,
      `Only ${entries.length} ${entries.length === 1 ? "entry" : "entries"} registered.`,
    );
    return {
      outcome: "cancelled",
      reason: `Fewer than the ${tournament.minEntries} entries needed, so the tournament was cancelled and entries refunded.`,
    };
  }

  // v1 seeds at random — `shuffle` takes an injectable source so a seeded draw
  // by skill rating is a change of one argument later.
  const seeded = shuffle(entries);
  const config = resolveFormatConfig(tournament.format, seeded.length, tournament);
  // A pool draw is snaked across the pools, so the entry rows have to record
  // which pool they were drawn into before any match refers to it.
  const pools = tournament.format === "pool_to_bracket" ? assignPools(seeded.length, config.poolCount) : null;

  await prisma.$transaction(
    seeded.map((entry, i) =>
      prisma.registration.update({
        where: { id: entry.id },
        data: { seed: i + 1, pool: pools ? pools[i] + 1 : null },
      }),
    ),
  );

  const plan = buildDrawPlan(tournament.format, seeded.length, config);
  await createPlannedMatches(
    tournamentId,
    plan,
    plan.map((m) => ({
      a: m.sideAIndex == null ? null : seeded[m.sideAIndex].id,
      b: m.sideBIndex == null ? null : seeded[m.sideBIndex].id,
    })),
  );

  await prisma.tournament.update({
    where: { id: tournamentId },
    data: {
      status: "registration_closed",
      estimatedEndAt: estimateEndAt({
        startAt: tournament.startAt,
        format: tournament.format,
        entries: seeded.length,
        courtCount: tournament.courts.length,
        pacing: await pacingFor(tournament),
        config,
      }),
    },
  });

  // Byes are resolved by the same pass that queues everything else — a bye is
  // just a match that can't be played.
  await refreshMatchStates(tournamentId);
  // The block was sized off `maxEntries` at publish; the real draw is usually
  // smaller, so the courts go back to the calendar for the time it won't need.
  await syncCourtBlocks(tournamentId);

  return { outcome: "drawn", matches: plan.length, entries: seeded.length };
}

/**
 * Write a planned set of matches, wiring included, in one statement.
 *
 * The ids are generated here rather than by the database, which is what lets a
 * match name the match it feeds in the very same insert: Postgres checks a
 * foreign key at the end of the *statement*, so rows in one multi-row insert may
 * reference each other in any order, forwards included.
 *
 * The obvious alternative — insert everything, then update each row with the id
 * of the row it points at — costs a round trip per match inside a transaction,
 * and that does not survive contact with a real database. A 16-entry double
 * elimination is 31 matches; 31 sequential updates is several seconds of
 * latency, and Prisma gives a transaction five.
 *
 * Positions are `(round, matchNumber)`, unique per tournament. A plan that
 * points at a match outside its own batch is looked up — the formats that add
 * rounds as they go don't currently do that, but nothing here assumes it.
 */
async function createPlannedMatches(
  tournamentId: string,
  plan: readonly PlannedMatch[],
  sides: readonly { a: string | null; b: string | null }[],
): Promise<void> {
  if (plan.length === 0) return;

  const positionKey = (round: number | null, matchNumber: number | null) =>
    round == null || matchNumber == null ? null : `${round}:${matchNumber}`;

  const idByPosition = new Map<string, string>();
  for (const m of plan) idByPosition.set(`${m.round}:${m.matchNumber}`, randomUUID());

  const outside = plan
    .flatMap((m) => [
      positionKey(m.nextRound, m.nextMatchNumber),
      positionKey(m.loserNextRound, m.loserNextMatchNumber),
    ])
    .filter((key): key is string => key != null && !idByPosition.has(key));
  if (outside.length > 0) {
    const existing = await prisma.match.findMany({
      where: { tournamentId },
      select: { id: true, round: true, matchNumber: true },
    });
    for (const m of existing) {
      const key = `${m.round}:${m.matchNumber}`;
      if (!idByPosition.has(key)) idByPosition.set(key, m.id);
    }
  }

  const at = (round: number | null, matchNumber: number | null): string | null => {
    const key = positionKey(round, matchNumber);
    return key == null ? null : (idByPosition.get(key) ?? null);
  };

  await prisma.match.createMany({
    data: plan.map((m, i) => {
      const nextMatchId = at(m.nextRound, m.nextMatchNumber);
      const loserNextMatchId = at(m.loserNextRound, m.loserNextMatchNumber);
      return {
        id: idByPosition.get(`${m.round}:${m.matchNumber}`) as string,
        tournamentId,
        round: m.round,
        matchNumber: m.matchNumber,
        sideARegistrationId: sides[i]?.a ?? null,
        sideBRegistrationId: sides[i]?.b ?? null,
        bracket: m.bracket,
        pool: m.pool,
        nextMatchId,
        // A slot without a target would be a dangling half-edge.
        nextMatchSlot: nextMatchId ? m.nextSlot : null,
        loserNextMatchId,
        loserNextMatchSlot: loserNextMatchId ? m.loserNextSlot : null,
      };
    }),
  });
}

/** Write a winner into the slot of the match they advance to. No-op for a
 *  round robin or a final, neither of which has one. */
async function placeWinner(
  match: { nextMatchId: string | null; nextMatchSlot: "A" | "B" | null },
  winnerRegistrationId: string,
): Promise<void> {
  if (!match.nextMatchId || !match.nextMatchSlot) return;
  await prisma.match.update({
    where: { id: match.nextMatchId },
    data:
      match.nextMatchSlot === "A"
        ? { sideARegistrationId: winnerRegistrationId }
        : { sideBRegistrationId: winnerRegistrationId },
  });
}

/**
 * Write a loser into the losers-bracket slot they drop to. Double elimination
 * only — every other format leaves `loserNextMatchId` null, and a loser simply
 * stops.
 */
async function placeLoser(
  match: { loserNextMatchId: string | null; loserNextMatchSlot: "A" | "B" | null },
  loserRegistrationId: string,
): Promise<void> {
  if (!match.loserNextMatchId || !match.loserNextMatchSlot) return;
  await prisma.match.update({
    where: { id: match.loserNextMatchId },
    data:
      match.loserNextMatchSlot === "A"
        ? { sideARegistrationId: loserRegistrationId }
        : { sideBRegistrationId: loserRegistrationId },
  });
}

/**
 * Move every match that can move: onto the queue if it's playable, or straight
 * to a walkover if it can't be played. Runs after every draw, advance, and
 * withdrawal rather than being threaded through each of them.
 *
 * Two things make a match unplayable, and both resolve to a walkover for
 * whoever is left:
 *
 *  - **A side withdrew.** Their opponent may not even be known yet (an entry
 *    that drew a bye sits in round 2 opposite a slot nobody has won), so this
 *    can't be handled at withdrawal time — it's caught here, whenever the
 *    opponent does arrive.
 *  - **A side is never coming.** A match with one empty side and no unfinished
 *    feeders will never get an opponent. In round 1 that's an ordinary bye from
 *    padding the draw to a power of two; deeper in it's what's left when both
 *    of a slot's feeders dissolved.
 *
 * Resolving one match fills the next, which may itself be unplayable, so this
 * loops until nothing moves.
 */
export async function refreshMatchStates(tournamentId: string): Promise<void> {
  // Bounded rather than `while (true)`: a bracket is at most a handful of
  // rounds deep, and a cycle in the wiring must not spin forever.
  for (let pass = 0; pass < 32; pass++) {
    const pending = await prisma.match.findMany({
      where: { tournamentId, status: "pending" },
      select: {
        id: true,
        sideARegistrationId: true,
        sideBRegistrationId: true,
        nextMatchId: true,
        nextMatchSlot: true,
        sideA: { select: { status: true } },
        sideB: { select: { status: true } },
        feederMatches: { select: { status: true } },
        // A losers-bracket match is fed by a winners-bracket match's loser as
        // much as by a losers-bracket match's winner. Leaving these out would
        // let it resolve as a bye while the entry due to drop into it is still
        // playing.
        loserFeederMatches: { select: { status: true } },
      },
    });
    if (pending.length === 0) return;

    const readyIds: string[] = [];
    let moved = false;

    for (const match of pending) {
      const aOut = match.sideA?.status === "withdrawn";
      const bOut = match.sideB?.status === "withdrawn";
      const bothKnown = match.sideARegistrationId != null && match.sideBRegistrationId != null;
      const oneKnown = match.sideARegistrationId != null || match.sideBRegistrationId != null;
      const feedersDone = [...match.feederMatches, ...match.loserFeederMatches].every(
        (f) => f.status === "completed" || f.status === "walkover",
      );

      let winner: string | null | undefined;
      if (bothKnown && (aOut || bOut)) {
        winner = aOut && bOut ? null : aOut ? match.sideBRegistrationId : match.sideARegistrationId;
      } else if (bothKnown) {
        readyIds.push(match.id);
        continue;
      } else if (oneKnown && feedersDone) {
        const present = match.sideARegistrationId ?? match.sideBRegistrationId;
        // A lone entry that has itself withdrawn advances nobody.
        winner = (match.sideA ?? match.sideB)?.status === "withdrawn" ? null : present;
      } else if (!oneKnown && feedersDone) {
        // Nothing can ever fill this one; close it so the round above isn't
        // left waiting on a match that will never be played.
        winner = null;
      } else {
        continue;
      }

      await prisma.match.update({
        where: { id: match.id },
        data: { status: "walkover", winnerRegistrationId: winner ?? null, completedAt: new Date(), courtId: null },
      });
      moved = true;
      if (winner) await placeWinner(match, winner);
    }

    if (readyIds.length > 0) {
      await prisma.match.updateMany({ where: { id: { in: readyIds } }, data: { status: "ready" } });
    }
    if (!moved) return;
  }
}

/* ------------------------------------------------------------------ *
 * The live court queue
 * ------------------------------------------------------------------ */

/**
 * Put queued matches on whatever courts are free. Called at the start of play
 * and again after every completion — the plan's "assign as courts free up"
 * rather than a pre-computed timetable, because match lengths vary too much to
 * schedule two courts ahead of time.
 */
export async function assignFreeCourts(tournamentId: string, now: Date = new Date()): Promise<number> {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: { courts: { orderBy: { courtId: "asc" } }, sessions: true },
  });
  if (!tournament || tournament.status !== "in_progress") return 0;

  const matches = await prisma.match.findMany({
    where: { tournamentId, status: { in: ["ready", "in_progress"] } },
    select: {
      id: true,
      round: true,
      matchNumber: true,
      status: true,
      courtId: true,
      sessionId: true,
      sideARegistrationId: true,
      sideBRegistrationId: true,
    },
  });

  /* A scheduled match only gets called inside its own window — that is what
     makes "round 1 is Monday 8–10" mean anything. An unscheduled match (no
     session, or a tournament with no sessions at all) can be called whenever
     the tournament is running, so the original behaviour is what you get until
     somebody builds a schedule. An admin can still force any match onto a
     court by hand from the run-day view. */
  const openSessionIds = new Set(
    tournament.sessions.filter((s) => now >= s.startAt && now < s.endAt).map((s) => s.id),
  );
  const callable = matches.filter(
    (m) => m.status !== "ready" || m.sessionId == null || openSessionIds.has(m.sessionId),
  );

  const assignments = planCourtAssignments({
    readyMatches: callable.filter((m) => m.status === "ready"),
    liveMatches: matches.filter((m) => m.status === "in_progress"),
    courtIds: tournament.courts.map((c) => c.courtId),
  });

  // `updateMany` with the status in the filter, not `update` by id: two admins
  // recording scores at the same moment would otherwise both send a match onto
  // a court. Whoever gets there second matches no rows and changes nothing.
  const results = await prisma.$transaction(
    assignments.map((a) =>
      prisma.match.updateMany({
        where: { id: a.matchId, status: "ready" },
        data: { courtId: a.courtId, status: "in_progress", scheduledAt: now },
      }),
    ),
  );

  return results.reduce((sum, r) => sum + r.count, 0);
}

/** Play is over once nothing is left to play. */
export async function completeIfFinished(tournamentId: string): Promise<boolean> {
  const remaining = await prisma.match.count({
    where: { tournamentId, status: { in: ["pending", "ready", "in_progress"] } },
  });
  if (remaining > 0) return false;

  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { status: true } });
  if (!tournament || tournament.status !== "in_progress") return false;

  // `completedAt` is stamped here and nowhere else — the deletion retention
  // window counts from it, so it has to mean "the last match was played".
  await prisma.tournament.update({
    where: { id: tournamentId },
    data: { status: "completed", completedAt: new Date() },
  });
  await releaseCourtBlocks(tournamentId);
  return true;
}

/**
 * Everything that follows a match ending, however it ended: advance the winner,
 * drop the loser if the format catches them, extend the draw if this was the
 * last match a later stage was waiting on, open up whatever that made playable,
 * refill the free court, and close the tournament if that was the last match.
 *
 * The match is re-read here rather than passed in. Its routing is now four
 * columns rather than two, and a caller that selected the old two would drop
 * nobody into the losers bracket while looking like it worked.
 */
export async function settleAfterMatch(tournamentId: string, matchId: string): Promise<void> {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: {
      status: true,
      bracket: true,
      sideARegistrationId: true,
      sideBRegistrationId: true,
      winnerRegistrationId: true,
      nextMatchId: true,
      nextMatchSlot: true,
      loserNextMatchId: true,
      loserNextMatchSlot: true,
    },
  });

  if (match?.winnerRegistrationId) {
    await placeWinner(match, match.winnerRegistrationId);

    /* Only a match that was actually played sends someone down. A walkover
       means one side never turned up, and an entry that didn't turn up doesn't
       get a second life — leaving the slot empty lets their would-be opponent
       through as a bye, which is the same result with less fiction in it. */
    if (match.status === "completed") {
      const loserId =
        match.winnerRegistrationId === match.sideARegistrationId
          ? match.sideBRegistrationId
          : match.sideARegistrationId;
      if (loserId) await placeLoser(match, loserId);

      /* The grand final is the one match whose result changes the shape of what
         is left. The winners-bracket champion arrives unbeaten, so if they win,
         it's over and the reset is walked over as a formality. If the
         losers-bracket champion wins, both sides are on one loss and the reset
         is a real match — the second half of being twice to beat. */
      if (match.bracket === "grand_final" && match.winnerRegistrationId === match.sideBRegistrationId && loserId) {
        await placeLoser(
          { loserNextMatchId: match.nextMatchId, loserNextMatchSlot: "B" },
          loserId,
        );
      }
    }
  }

  await growDraw(tournamentId);
  await refreshMatchStates(tournamentId);
  await assignFreeCourts(tournamentId);
  await completeIfFinished(tournamentId);
}

/* ------------------------------------------------------------------ *
 * Draws that grow
 * ------------------------------------------------------------------ */

/**
 * Add the matches that couldn't be planned until some had been played.
 *
 * Two formats need this. A `pool_to_bracket` knockout is drawn from the pool
 * tables, which don't exist until the pools are finished. A `swiss` round is
 * paired on the standings, so round *n+1* can't be written until round *n* is
 * in. Everything else is planned in full at the draw and this does nothing.
 *
 * Safe to call at any time and idempotent, because it is: nothing here fires
 * until the stage it waits on is complete, and each stage is created once.
 */
export async function growDraw(tournamentId: string): Promise<boolean> {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: {
      id: true,
      format: true,
      poolCount: true,
      advancePerPool: true,
      swissRounds: true,
      status: true,
    },
  });
  if (!tournament || !drawGrows(tournament.format)) return false;
  if (tournament.status !== "in_progress" && tournament.status !== "registration_closed") return false;

  return tournament.format === "pool_to_bracket"
    ? growPoolKnockout(tournament)
    : growSwissRound(tournament);
}

type GrowingTournament = {
  id: string;
  poolCount: number | null;
  advancePerPool: number | null;
  swissRounds: number | null;
};

/** Draw the knockout once every pool match is in, seeding it from the tables. */
async function growPoolKnockout(tournament: GrowingTournament): Promise<boolean> {
  const matches = await prisma.match.findMany({
    where: { tournamentId: tournament.id },
    select: {
      status: true,
      pool: true,
      round: true,
      score: true,
      sideARegistrationId: true,
      sideBRegistrationId: true,
      winnerRegistrationId: true,
    },
  });

  // The knockout exists already, or the pools are still being played.
  if (matches.some((m) => m.pool == null)) return false;
  const settled = (s: string) => s === "completed" || s === "walkover";
  if (matches.length === 0 || !matches.every((m) => settled(m.status))) return false;

  const entries = await prisma.registration.findMany({
    where: { tournamentId: tournament.id, pool: { not: null } },
    select: { id: true, pool: true, status: true },
  });
  const config = resolveFormatConfig("pool_to_bracket", entries.length, tournament);

  /* One table per pool, in the same order the pool page shows: wins, then
     points. Withdrawn entries stay in the table they played in but can't take
     a knockout place. */
  const tables = new Map<number, string[]>();
  for (let pool = 1; pool <= config.poolCount; pool++) {
    const inPool = entries.filter((e) => e.pool === pool);
    const standings = buildStandings(
      inPool.map((e) => e.id),
      matches.filter((m) => m.pool === pool),
    );
    const eligible = new Set(inPool.filter((e) => e.status !== "withdrawn").map((e) => e.id));
    tables.set(
      pool,
      standings.map((row) => row.registrationId).filter((id) => eligible.has(id)),
    );
  }

  const qualified = [...tables.values()].reduce((sum, table) => sum + Math.min(table.length, config.advancePerPool), 0);
  if (qualified < MIN_TOURNAMENT_ENTRIES) return false;

  const fieldSize = bracketFieldSize(qualified, config);
  const lastPoolRound = Math.max(...matches.map((m) => m.round));
  const plan = buildPoolKnockoutPlan(fieldSize, lastPoolRound);

  /* The seeding decides which slot each pool's Nth-placed entry takes; slots
     past the qualifier count are byes, exactly as in any other bracket. */
  const slots = seedPoolQualifiers(config, fieldSize);
  const registrationForSlot = (index: number): string | null => {
    const q = slots[index];
    if (!q) return null;
    return tables.get(q.pool + 1)?.[q.place] ?? null;
  };

  const sides = plan.map((m) =>
    m.round === lastPoolRound + 1
      ? { a: registrationForSlot((m.matchNumber - 1) * 2), b: registrationForSlot((m.matchNumber - 1) * 2 + 1) }
      : { a: null, b: null },
  );

  await createPlannedMatches(tournament.id, plan, sides);
  return true;
}

/** Pair and write the next Swiss round, once the current one is complete. */
async function growSwissRound(tournament: GrowingTournament): Promise<boolean> {
  const matches = await prisma.match.findMany({
    where: { tournamentId: tournament.id },
    select: {
      round: true,
      status: true,
      score: true,
      sideARegistrationId: true,
      sideBRegistrationId: true,
      winnerRegistrationId: true,
    },
  });
  if (matches.length === 0) return false;

  const drawn = await prisma.registration.findMany({
    where: { tournamentId: tournament.id, seed: { not: null } },
    select: { id: true, status: true },
    orderBy: { seed: "asc" },
  });
  /* How many rounds this draw plays was settled by the field that started it.
     Resolving it against the survivors instead would let a single withdrawal
     shorten the tournament under everybody still playing. */
  const config = resolveFormatConfig("swiss", drawn.length, tournament);
  const entries = drawn.filter((e) => e.status !== "withdrawn");

  const roundsPlayed = Math.max(...matches.map((m) => m.round));
  if (roundsPlayed >= config.swissRounds) return false;
  const settled = (s: string) => s === "completed" || s === "walkover";
  if (!matches.every((m) => settled(m.status))) return false;

  const standings = buildStandings(
    entries.map((e) => e.id),
    matches,
  );
  const played = new Set(
    matches
      .filter((m) => m.sideARegistrationId && m.sideBRegistrationId)
      .map((m) => pairKey(m.sideARegistrationId as string, m.sideBRegistrationId as string)),
  );

  const pairs = pairSwissRound({ order: standings.map((row) => row.registrationId), played });
  const round = roundsPlayed + 1;
  const plan: PlannedMatch[] = pairs.map((_, i) => ({
    round,
    matchNumber: i + 1,
    sideAIndex: null,
    sideBIndex: null,
    nextRound: null,
    nextMatchNumber: null,
    nextSlot: null,
    loserNextRound: null,
    loserNextMatchNumber: null,
    loserNextSlot: null,
    bracket: null,
    pool: null,
  }));

  await createPlannedMatches(
    tournament.id,
    plan,
    pairs.map((p) => ({ a: p.a, b: p.b })),
  );
  return true;
}

/* ------------------------------------------------------------------ *
 * Cancellation and refunds
 * ------------------------------------------------------------------ */

/**
 * Entry fees are collected off-app (there is no tournament payment flow yet —
 * `feePaid` is a box an admin ticks), so this is the hook the plan asks for
 * rather than a real reversal. It is deliberately loud in the log: someone has
 * to hand the money back, and this is the record that they must.
 */
export function refundEntryFee(registration: { id: string; tournamentId: string; feePaid: boolean }): void {
  if (!registration.feePaid) return;
  console.info(
    `[tournament] refund owed — registration ${registration.id} in tournament ${registration.tournamentId}`,
  );
}

/** Cancel a tournament: withdraw every entry, flag the refunds, release the
 *  courts. Shared by the admin action and the auto-cancel on a short draw. */
export async function cancelTournamentRecord(tournamentId: string, reason: string): Promise<void> {
  const entries = await prisma.registration.findMany({
    where: { tournamentId, status: { not: "withdrawn" } },
    select: { id: true, tournamentId: true, feePaid: true },
  });
  console.info(`[tournament] cancelling ${tournamentId}: ${reason}`);
  for (const entry of entries) refundEntryFee(entry);

  await prisma.registration.updateMany({
    where: { tournamentId, status: { not: "withdrawn" } },
    data: { status: "withdrawn" },
  });
  await prisma.tournament.update({ where: { id: tournamentId }, data: { status: "cancelled" } });
  await releaseCourtBlocks(tournamentId);
}

/* ------------------------------------------------------------------ *
 * Waitlist
 * ------------------------------------------------------------------ */

/** Move the longest-waiting waitlisted entries up, if there's room and anyone
 *  waiting. Runs after any withdrawal or a raise to `maxEntries`.
 *
 *  Stops once the draw exists: past that point a promotion can't put anyone
 *  into a bracket that's already wired, and would only add an entry with no
 *  matches to the results. Withdrawals after the draw are handled by
 *  `refreshMatchStates` awarding the walkover instead. */
export async function promoteFromWaitlist(tournamentId: string): Promise<number> {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { maxEntries: true, _count: { select: { matches: true } } },
  });
  if (!tournament || tournament._count.matches > 0) return 0;

  const registered = await prisma.registration.count({ where: { tournamentId, status: "registered" } });
  const room = tournament.maxEntries - registered;
  if (room <= 0) return 0;

  const waiting = await prisma.registration.findMany({
    where: { tournamentId, status: "waitlisted" },
    orderBy: { registeredAt: "asc" },
    take: room,
    select: { id: true },
  });
  if (waiting.length === 0) return 0;

  await prisma.registration.updateMany({
    where: { id: { in: waiting.map((w) => w.id) } },
    data: { status: "registered" },
  });
  return waiting.length;
}

/* ------------------------------------------------------------------ *
 * The lazy sweep
 * ------------------------------------------------------------------ */

/** How stale a tournament listing may let a passed deadline look. */
const SWEEP_INTERVAL_MS = 30_000;

let lastSweepAtMs = 0;
let inFlight: Promise<void> | null = null;

/**
 * Advance any tournament whose clock has run out: close registration (drawing
 * the bracket, or cancelling a draw that came up short) and start play at
 * `startAt`. Called at the top of the tournament pages, the same lazy pattern
 * `reapExpiredBookings` uses — this deployment has no long-running process to
 * hang a cron job on.
 */
export async function sweepTournaments(opts?: { force?: boolean }): Promise<void> {
  if (inFlight) return inFlight;
  if (!opts?.force && Date.now() - lastSweepAtMs < SWEEP_INTERVAL_MS) return;

  inFlight = runSweep().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runSweep(): Promise<void> {
  const now = new Date();

  const toClose = await prisma.tournament.findMany({
    where: { status: "registration_open", registrationClosesAt: { lte: now } },
    select: { id: true },
  });
  for (const { id } of toClose) {
    await closeRegistrationAndDraw(id);
  }

  /* Play starts at whichever comes first: the declared start time, or the
     first scheduled window. An admin who builds a schedule shouldn't also have
     to remember to drag `startAt` back to match it. */
  const drawn = await prisma.tournament.findMany({
    where: { status: "registration_closed" },
    select: { id: true, startAt: true, sessions: { orderBy: { startAt: "asc" }, take: 1 } },
  });
  for (const t of drawn) {
    const effectiveStart = t.sessions[0] ? new Date(Math.min(t.startAt.getTime(), t.sessions[0].startAt.getTime())) : t.startAt;
    if (effectiveStart > now) continue;
    await prisma.tournament.update({ where: { id: t.id }, data: { status: "in_progress" } });
    await assignFreeCourts(t.id, now);
  }

  /* A window opening is a thing that happens on a clock, not in response to a
     result, so nothing else would notice it. Re-running the assignment for
     everything live is what lets Monday's round go on court at 8am without an
     admin pressing anything.

     `growDraw` runs here too, though a result normally triggers it. If a
     process died between the last pool match and the knockout being drawn, the
     tournament would otherwise sit finished-but-not-finished until somebody
     recorded a score that no longer exists. */
  const live = await prisma.tournament.findMany({ where: { status: "in_progress" }, select: { id: true } });
  for (const { id } of live) {
    if (await growDraw(id)) await refreshMatchStates(id);
    await assignFreeCourts(id, now);
    await completeIfFinished(id);
  }

  lastSweepAtMs = Date.now();
}
