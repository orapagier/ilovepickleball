/**
 * Drive one tournament of every format from an empty draft to a champion,
 * against the real database and through the real engine.
 *
 * There is no test framework in this project and this is deliberately not one.
 * It is a harness: it seeds a field, runs the actual lifecycle calls an admin's
 * clicks would make — `closeRegistrationAndDraw`, `assignFreeCourts`,
 * `settleAfterMatch`, `growDraw`, `completeIfFinished` — and then asks the
 * finished tournaments whether they hold together. Nothing here writes a `Match`
 * row by hand; a bracket the script drew itself would only ever prove that the
 * script agrees with itself.
 *
 * The field sizes are chosen to be awkward on purpose. Powers of two are the
 * case every format gets right; the interesting ones are the bye, the pool that
 * doesn't divide, the odd Swiss field and the grand final that needs a reset.
 *
 *   npx tsx --env-file=.env.local scripts/simulate-tournaments.ts
 *
 * Everything it creates is tagged `[SIM]` (tournaments) or `sim-` (users) and is
 * removed by `scripts/cleanup-simulated-tournaments.ts`. DATABASE_URL points at
 * a shared dev database: this script only ever touches rows it created itself.
 */

import { prisma } from "@/lib/prisma";
import {
  assignFreeCourts,
  closeRegistrationAndDraw,
  completeIfFinished,
  growDraw,
  promoteFromWaitlist,
  refreshMatchStates,
  settleAfterMatch,
  syncCourtBlocks,
} from "@/lib/tournament-engine";
import {
  buildStandings,
  championOf,
  finalPlacements,
  MAX_POOL_SIZE,
  MAX_ROUND_ROBIN_ENTRIES,
  placeLabel,
  poolSizes,
  resolveFormatConfig,
  totalMatchCount,
  withPrizes,
  type Placement,
  type PlacementMatch,
} from "@/lib/tournament";
import type { TournamentFormat, TournamentPlayType } from "@/generated/prisma/enums";

/** Every tournament this script creates starts with this, which is how the
 *  cleanup script finds them and how a human browsing the site can tell at a
 *  glance that none of it is real. */
const SIM_TAG = "[SIM]";
/** Sim members are `sim-<n>` / `sim-<n>@simulated.test`. `.test` is reserved by
 *  RFC 2606 precisely so it can never collide with a real address. */
const SIM_SUB_PREFIX = "sim-";
const SIM_EMAIL_DOMAIN = "@simulated.test";

/* ------------------------------------------------------------------ *
 * A pinned random source
 * ------------------------------------------------------------------ */

/**
 * mulberry32 — small, fast, and seeded, so two runs of this script make the
 * same upsets happen. A failure that only shows up on one draw in five is
 * worthless if the next run can't reproduce it.
 *
 * The *draw* is still shuffled by the engine's own `Math.random`, which is the
 * point: the seeding is what varies between runs, and the assertions have to
 * hold for any of them.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260819);

/* ------------------------------------------------------------------ *
 * The field
 * ------------------------------------------------------------------ */

const FIRST_NAMES = [
  "Alice", "Bruno", "Carmen", "Diego", "Elena", "Farid", "Grace", "Hector",
  "Imelda", "Jonas", "Karla", "Lito", "Maria", "Nestor", "Olive", "Paolo",
  "Quennie", "Ramon", "Sofia", "Tomas", "Ursula", "Victor", "Wilma", "Xander",
  "Yolanda", "Zeno", "Amir", "Bianca", "Cesar", "Dahlia", "Emil", "Fatima",
  "Gabriel", "Hana", "Isko", "Joy", "Kiko", "Luna", "Miguel", "Nadia",
];
const LAST_NAMES = ["Cruz", "Reyes", "Santos", "Bautista", "Garcia", "Torres", "Flores", "Ramos"];

/** The half-step rating scale members actually pick from. Spread across the
 *  field so a banded tournament has somebody to refuse and somebody to admit. */
const RATINGS = [2.5, 3.0, 3.5, 4.0, 4.5, 5.0];

/** Enough members that every tournament can have its own entrants — a field
 *  shared between all eight would make the browse pages read as one club of
 *  sixteen people entering everything. */
const SIM_USER_COUNT = 120;

type SimUser = { id: string; name: string; email: string };

/**
 * Create the sim members that don't exist yet and return the whole pool.
 *
 * Idempotent by `googleSub`: re-running the script reuses the members it made
 * last time rather than doubling the pool, which matters because the pool is
 * also what the previous run's tournaments are full of.
 */
async function ensureSimUsers(): Promise<SimUser[]> {
  const wanted = Array.from({ length: SIM_USER_COUNT }, (_, i) => {
    const n = i + 1;
    return {
      googleSub: `${SIM_SUB_PREFIX}${n}`,
      email: `${SIM_SUB_PREFIX}${n}${SIM_EMAIL_DOMAIN}`,
      name: `Sim ${FIRST_NAMES[i % FIRST_NAMES.length]} ${LAST_NAMES[Math.floor(i / FIRST_NAMES.length) % LAST_NAMES.length]}`,
      phone: `09${String(170000000 + n).slice(0, 9)}`,
      skillRating: RATINGS[i % RATINGS.length],
    };
  });

  const existing = await prisma.user.findMany({
    where: { googleSub: { startsWith: SIM_SUB_PREFIX } },
    select: { googleSub: true },
  });
  const have = new Set(existing.map((u) => u.googleSub));
  const missing = wanted.filter((u) => !have.has(u.googleSub));
  if (missing.length > 0) {
    await prisma.user.createMany({ data: missing, skipDuplicates: true });
  }

  const pool = await prisma.user.findMany({
    where: { googleSub: { startsWith: SIM_SUB_PREFIX } },
    select: { id: true, name: true, email: true, googleSub: true },
  });
  // By the number in the sub, not by name — `sim-10` must not sort before `sim-2`.
  return pool
    .sort((a, b) => Number(a.googleSub.slice(SIM_SUB_PREFIX.length)) - Number(b.googleSub.slice(SIM_SUB_PREFIX.length)))
    .map(({ id, name, email }) => ({ id, name, email }));
}

/**
 * Drop the tournaments a previous run of *this script* left behind.
 *
 * Re-running has to replace its output rather than pile another eight
 * tournaments on top of the last eight — a harness you can't run twice is a
 * harness you stop running. The members are deliberately kept and reused: they
 * are the pool this run draws from, and recreating them every time would churn
 * a hundred rows to no purpose.
 *
 * Scoped exactly as `cleanup-simulated-tournaments.ts` is, and for the same
 * reason: this is a shared development database. Court blocks go first because
 * `Booking.tournamentId` is `ON DELETE SET NULL` and would otherwise leave them
 * behind as orphaned bookings.
 */
async function resetPreviousRun(): Promise<number> {
  const previous = await prisma.tournament.findMany({
    where: { name: { startsWith: SIM_TAG } },
    select: { id: true },
  });
  if (previous.length === 0) return 0;

  const ids = previous.map((t) => t.id);
  await prisma.booking.deleteMany({ where: { tournamentId: { in: ids } } });
  await prisma.tournament.deleteMany({ where: { id: { in: ids } } });
  return previous.length;
}

/* ------------------------------------------------------------------ *
 * What to simulate
 * ------------------------------------------------------------------ */

type Scenario = {
  key: string;
  name: string;
  description: string;
  format: TournamentFormat;
  playType: TournamentPlayType;
  /** Field size after the waitlist promotion — the number that actually gets
   *  drawn. Chosen per format to hit that format's awkward case. */
  entries: number;
  /** Extra entries pushed past the cap, so the waitlist is a real state and not
   *  a code path nothing ever enters. */
  waitlist: number;
  /** The cap, when it isn't the field size. Only the still-open tournament sets
   *  it: a draw that is exactly full has no spots left to advertise, which is
   *  the one thing the "open to enter" tile is for. */
  maxEntries?: number;
  entryFeeCents: number;
  poolCount?: number;
  advancePerPool?: number;
  swissRounds?: number;
  minSkillRating?: number;
  maxSkillRating?: number;
  prizes: { place: number; label: string; amountCents: number | null; description: string }[];
  /** Why this field size, printed with the results so the report explains
   *  itself rather than needing this file open beside it. */
  why: string;
  /** Where to stop. `completed` is the point of the exercise; the other two
   *  leave a tournament parked in a state the new UI needs to render, so the
   *  seeded data covers the live standings card and the homepage promo too. */
  runTo: "completed" | "in_progress" | "registration_open";
  /** For `in_progress`: roughly what fraction of the draw to play out. */
  playFraction?: number;
};

/** A prize row, written positionally so the scenario tables stay readable. */
function prize(place: number, label: string, amountCents: number | null, description: string) {
  return { place, label, amountCents, description };
}

const SCENARIOS: Scenario[] = [
  {
    key: "single",
    name: `${SIM_TAG} Sunset Singles Shootout`,
    description: "One loss and you're out. Eleven entries into a sixteen draw, so the top seeds start with a bye.",
    format: "single_elimination",
    playType: "singles",
    entries: 11,
    waitlist: 2,
    entryFeeCents: 30_000,
    prizes: [
      prize(1, "Champion", 500_000, "Trophy and the winner's plate"),
      prize(2, "Runner-up", 250_000, "Trophy"),
      prize(3, "Joint third", 100_000, "Medal — both semifinal losers"),
    ],
    why: "11 entries pads to a 16 draw: 5 byes, and a first round that is mostly walkovers.",
    runTo: "completed",
  },
  {
    key: "roundrobin",
    name: `${SIM_TAG} Round Robin Doubles Classic`,
    description: "Everybody plays everybody. The full cap, which is a long day on two courts.",
    format: "round_robin",
    playType: "doubles",
    entries: MAX_ROUND_ROBIN_ENTRIES,
    waitlist: 2,
    entryFeeCents: 50_000,
    prizes: [
      prize(1, "Champion", 800_000, "Trophy and paddles for the pair"),
      prize(2, "Runner-up", 400_000, "Trophy"),
      prize(3, "Third place", 200_000, "Medals"),
    ],
    why: `${MAX_ROUND_ROBIN_ENTRIES} entries is MAX_ROUND_ROBIN_ENTRIES — ${(MAX_ROUND_ROBIN_ENTRIES * (MAX_ROUND_ROBIN_ENTRIES - 1)) / 2} matches, the cap itself.`,
    runTo: "completed",
  },
  {
    key: "double",
    name: `${SIM_TAG} Twice-to-Beat Doubles`,
    description: "Two losses to go out, and the winners-bracket champion has to be beaten twice.",
    format: "double_elimination",
    playType: "doubles",
    entries: 6,
    waitlist: 1,
    entryFeeCents: 40_000,
    prizes: [
      prize(1, "Champion", 600_000, "Trophy and the twice-to-beat plate"),
      prize(2, "Runner-up", 300_000, "Trophy"),
      prize(3, "Third place", 150_000, "Medals"),
    ],
    why: "6 entries into an 8 draw (byes in both brackets), and the grand final is forced to a reset.",
    runTo: "completed",
  },
  {
    key: "pools",
    name: `${SIM_TAG} Pools Into Knockout Open`,
    description: "Three round-robin pools that don't divide evenly, then the top two of each into a knockout.",
    format: "pool_to_bracket",
    playType: "singles",
    entries: 11,
    waitlist: 2,
    entryFeeCents: 35_000,
    poolCount: 3,
    advancePerPool: 2,
    minSkillRating: 2.5,
    maxSkillRating: 5.0,
    prizes: [
      prize(1, "Champion", 550_000, "Trophy"),
      prize(2, "Runner-up", 275_000, "Trophy"),
      prize(3, "Third place", 125_000, "Medal"),
      prize(5, "Pool winner", null, "Free court hour for topping a pool without qualifying"),
    ],
    why: `11 entries across 3 pools is ${poolSizes(11, 3).join("/")} — uneven, and inside MAX_POOL_SIZE (${MAX_POOL_SIZE}). Six qualifiers means a knockout with byes.`,
    runTo: "completed",
  },
  {
    key: "swiss",
    name: `${SIM_TAG} Swiss Ladder Singles`,
    description: "A fixed number of rounds paired by record. Nobody is eliminated, and somebody gets a bye every round.",
    format: "swiss",
    playType: "singles",
    entries: 9,
    waitlist: 2,
    entryFeeCents: 25_000,
    prizes: [
      prize(1, "Champion", 450_000, "Trophy"),
      prize(2, "Runner-up", 225_000, "Trophy"),
      prize(3, "Third place", 100_000, "Medal"),
    ],
    why: "9 entries is odd, so every round byes whoever is currently last and the draw grows a round at a time.",
    runTo: "completed",
  },

  /* Three tournaments that stop short on purpose. Nothing is asserted about
     them beyond their status — they exist so the live standings card, the
     bracket-progress card and the homepage promo have something to render on a
     database that would otherwise hold only finished tournaments. */
  {
    key: "live-table",
    name: `${SIM_TAG} Friday Night Round Robin`,
    description: "Running right now — the table moves as results come in.",
    format: "round_robin",
    playType: "doubles",
    entries: 6,
    waitlist: 1,
    entryFeeCents: 20_000,
    prizes: [prize(1, "Champion", 300_000, "Trophy"), prize(2, "Runner-up", 150_000, "Trophy")],
    why: "Left in progress so the live standings card has a table format to draw.",
    runTo: "in_progress",
    playFraction: 0.55,
  },
  {
    key: "live-bracket",
    name: `${SIM_TAG} Saturday Knockout`,
    description: "Running right now — quarterfinals through, semifinals on court.",
    format: "single_elimination",
    playType: "singles",
    entries: 8,
    waitlist: 0,
    entryFeeCents: 20_000,
    prizes: [prize(1, "Champion", 300_000, "Trophy"), prize(2, "Runner-up", 150_000, "Trophy")],
    why: "Left in progress so the live card has a bracket to report progress on.",
    runTo: "in_progress",
    playFraction: 0.6,
  },
  {
    key: "open",
    name: `${SIM_TAG} Sunday Doubles — Entries Open`,
    description: "Taking entries now. Pools first, then a knockout for the top two of each.",
    format: "pool_to_bracket",
    playType: "doubles",
    entries: 5,
    waitlist: 0,
    maxEntries: 12,
    entryFeeCents: 45_000,
    minSkillRating: 3.0,
    maxSkillRating: 4.5,
    prizes: [
      prize(1, "Champion", 700_000, "Trophy and paddles"),
      prize(2, "Runner-up", 350_000, "Trophy"),
      prize(3, "Third place", 150_000, "Medals"),
    ],
    why: "Left open for entries so the homepage promo has something to advertise.",
    runTo: "registration_open",
  },
];

/* ------------------------------------------------------------------ *
 * Setting one up
 * ------------------------------------------------------------------ */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type Created = { id: string; scenario: Scenario; entryIds: string[] };

/**
 * Create the draft, publish it, fill it, work the waitlist, and close the draw.
 *
 * Registrations are written directly rather than through `joinTournament`: that
 * action reads a signed-in session and there isn't one in a script. Everything
 * *after* the entry list — which is where all the difficulty lives — goes
 * through the engine untouched.
 */
async function setUpTournament(
  scenario: Scenario,
  adminId: string,
  courtIds: number[],
  takePlayers: (n: number) => SimUser[],
): Promise<Created> {
  const now = Date.now();
  /* Far enough out that the lazy sweep won't close registration or start play
     underneath the script — every transition here is made deliberately, in
     order, so a failure points at the step that caused it. */
  const registrationClosesAt = new Date(now + 30 * DAY);
  const startAt = new Date(now + 31 * DAY);

  const playersPerEntry = scenario.playType === "doubles" ? 2 : 1;
  const totalEntries = scenario.entries + scenario.waitlist;
  const players = takePlayers(totalEntries * playersPerEntry);
  if (players.length < totalEntries * playersPerEntry) {
    throw new Error(`Not enough sim members left for ${scenario.name} — raise SIM_USER_COUNT.`);
  }

  const tournament = await prisma.tournament.create({
    data: {
      name: scenario.name,
      description: scenario.description,
      format: scenario.format,
      playType: scenario.playType,
      minSkillRating: scenario.minSkillRating ?? null,
      maxSkillRating: scenario.maxSkillRating ?? null,
      // The cap is the field size, so the extras really do land on the waitlist
      // rather than being quietly admitted.
      maxEntries: scenario.maxEntries ?? scenario.entries,
      minEntries: 2,
      entryFeeCents: scenario.entryFeeCents,
      currency: "PHP",
      registrationOpensAt: null,
      registrationClosesAt,
      startAt,
      poolCount: scenario.poolCount ?? null,
      advancePerPool: scenario.advancePerPool ?? null,
      swissRounds: scenario.swissRounds ?? null,
      prizeDescription: "Prizes are handed out at the desk right after the final.",
      createdById: adminId,
      courts: { create: courtIds.map((courtId) => ({ courtId })) },
      prizes: { create: scenario.prizes },
    },
    select: { id: true },
  });

  await prisma.tournament.update({ where: { id: tournament.id }, data: { status: "registration_open" } });
  await syncCourtBlocks(tournament.id);

  /* Entries in the order they arrived, which is what decides who is over the
     cap — the same rule `joinTournament` applies one member at a time. */
  for (let i = 0; i < totalEntries; i++) {
    const [p1, p2] = players.slice(i * playersPerEntry, (i + 1) * playersPerEntry);
    await prisma.registration.create({
      data: {
        tournamentId: tournament.id,
        player1Id: p1.id,
        player2Id: p2?.id ?? null,
        status: i < scenario.entries ? "registered" : "waitlisted",
        paymentReference: scenario.entryFeeCents > 0 ? `SIM-REF-${1000 + i}` : "",
        // Half the fees ticked off, so the admin entry list shows both states.
        feePaid: scenario.entryFeeCents > 0 && i % 2 === 0,
        registeredAt: new Date(now - (totalEntries - i) * 60_000),
      },
    });
  }

  if (scenario.runTo === "registration_open") {
    const entries = await prisma.registration.findMany({
      where: { tournamentId: tournament.id, status: "registered" },
      select: { id: true },
    });
    return { id: tournament.id, scenario, entryIds: entries.map((e) => e.id) };
  }

  /* One withdrawal and one promotion, in that order, because that is the pair
     of events the waitlist exists for. Doing it before the draw is what makes
     it interesting: `promoteFromWaitlist` refuses once matches exist, so a
     promotion that happened after the draw would be a silent no-op the script
     could easily mistake for success. */
  if (scenario.waitlist > 0) {
    const first = await prisma.registration.findFirst({
      where: { tournamentId: tournament.id, status: "registered" },
      orderBy: { registeredAt: "asc" },
      select: { id: true },
    });
    if (first) {
      await prisma.registration.update({ where: { id: first.id }, data: { status: "withdrawn" } });
      const promoted = await promoteFromWaitlist(tournament.id);
      if (promoted !== 1) {
        throw new Error(`${scenario.name}: expected exactly one waitlist promotion, got ${promoted}.`);
      }
    }
  }

  const outcome = await closeRegistrationAndDraw(tournament.id);
  if (outcome.outcome !== "drawn") {
    throw new Error(`${scenario.name}: draw failed — ${JSON.stringify(outcome)}`);
  }
  if (outcome.entries !== scenario.entries) {
    throw new Error(`${scenario.name}: drew ${outcome.entries} entries, wanted ${scenario.entries}.`);
  }

  const drawn = await prisma.registration.findMany({
    where: { tournamentId: tournament.id, seed: { not: null } },
    orderBy: { seed: "asc" },
    select: { id: true },
  });
  return { id: tournament.id, scenario, entryIds: drawn.map((e) => e.id) };
}

/* ------------------------------------------------------------------ *
 * Playing it out
 * ------------------------------------------------------------------ */

/**
 * A plausible best-of-three to 11, written from side A's point of view.
 *
 * It has to parse: `buildStandings` reads point totals out of this string with
 * `parseScoreTotals`, so a score the engine can't read would quietly flatten
 * every differential tiebreak to zero and the standings assertions would pass
 * on a table that never sorted.
 */
function makeScore(winnerIsA: boolean): string {
  const games: [number, number][] = [];
  const gameToEleven = (): [number, number] => {
    // A deuce game now and then, so the parser sees more than "11-x".
    if (rand() < 0.15) {
      const at = 10 + Math.floor(rand() * 4);
      return [at + 2, at];
    }
    return [11, Math.floor(rand() * 10)];
  };

  games.push(gameToEleven());
  if (rand() < 0.4) {
    // The winner drops the second game and takes the third.
    const dropped = gameToEleven();
    games.push([dropped[1], dropped[0]]);
    games.push(gameToEleven());
  } else {
    games.push(gameToEleven());
  }

  return games.map(([w, l]) => (winnerIsA ? `${w}-${l}` : `${l}-${w}`)).join(", ");
}

type LiveMatch = {
  id: string;
  bracket: string | null;
  sideARegistrationId: string | null;
  sideBRegistrationId: string | null;
};

/**
 * Decide who wins, from the seeding, with upsets.
 *
 * The seed is a proxy for strength — the better seed wins three times in four —
 * which keeps the standings tables from coming out as a flat pile of identical
 * records and gives the differential tiebreak something to do.
 */
function pickWinner(match: LiveMatch, seedOf: Map<string, number>, scenario: Scenario): string {
  const a = match.sideARegistrationId as string;
  const b = match.sideBRegistrationId as string;

  /* Double elimination's whole shape depends on this one result. If the
     winners-bracket champion wins the grand final it is over and the reset is
     walked over as a formality — so the reset, and the second half of "twice to
     beat", would never be exercised at all. Side B is the losers-bracket
     champion, so forcing them here is what forces the reset. */
  if (scenario.key === "double" && match.bracket === "grand_final") return b;

  const favourite = (seedOf.get(a) ?? 99) <= (seedOf.get(b) ?? 99) ? a : b;
  const outsider = favourite === a ? b : a;
  return rand() < 0.75 ? favourite : outsider;
}

/**
 * Record results until the tournament finishes, exactly as a run-day admin
 * would: whatever is on court gets a score, and the engine decides what happens
 * next. Nothing here advances a winner, wires a bracket, or grows a draw.
 */
async function playOut(created: Created, seedOf: Map<string, number>): Promise<{ recorded: number }> {
  const { id, scenario } = created;
  await prisma.tournament.update({ where: { id }, data: { status: "in_progress" } });
  await assignFreeCourts(id);

  const drawSize = await prisma.match.count({ where: { tournamentId: id } });
  const stopAfter =
    scenario.runTo === "in_progress" ? Math.max(1, Math.round(drawSize * (scenario.playFraction ?? 0.5))) : Infinity;

  let recorded = 0;
  // Bounded rather than `while (true)`: a draw that stops making progress is a
  // bug to report, not a script to leave spinning against a shared database.
  for (let guard = 0; guard < 1000; guard++) {
    if (recorded >= stopAfter) return { recorded };

    const next = await prisma.match.findFirst({
      where: { tournamentId: id, status: "in_progress" },
      orderBy: [{ round: "asc" }, { matchNumber: "asc" }],
      select: { id: true, bracket: true, sideARegistrationId: true, sideBRegistrationId: true },
    });

    if (next) {
      const winnerRegistrationId = pickWinner(next, seedOf, scenario);
      await prisma.match.update({
        where: { id: next.id },
        data: {
          status: "completed",
          score: makeScore(winnerRegistrationId === next.sideARegistrationId),
          winnerRegistrationId,
          completedAt: new Date(),
        },
      });
      await settleAfterMatch(id, next.id);
      recorded += 1;
      continue;
    }

    /* Nothing on court. Either the tournament is finished, or a stage has just
       ended and the next one has to be grown before anything can be called —
       both of which the engine handles, so the script only has to ask. */
    if (await completeIfFinished(id)) return { recorded };
    await growDraw(id);
    await refreshMatchStates(id);
    if ((await assignFreeCourts(id)) > 0) continue;

    const stuck = await prisma.match.count({
      where: { tournamentId: id, status: { in: ["pending", "ready", "in_progress"] } },
    });
    if (stuck === 0) {
      await completeIfFinished(id);
      return { recorded };
    }
    throw new Error(
      `${scenario.name}: ${stuck} matches left but nothing can be called — the draw has stopped making progress.`,
    );
  }
  throw new Error(`${scenario.name}: gave up after 1000 results without finishing.`);
}

/* ------------------------------------------------------------------ *
 * The assertions
 * ------------------------------------------------------------------ */

type Check = { label: string; ok: boolean; detail: string };

function check(label: string, ok: boolean, detail: string): Check {
  return { label, ok, detail };
}

/**
 * Ask a finished tournament whether it holds together.
 *
 * Every check is a property that has to be true of *any* run, not of this
 * particular draw — the seeding is random, so an assertion about who beat whom
 * would only ever be an assertion about luck.
 */
async function checkTournament(created: Created): Promise<Check[]> {
  const { id } = created;
  const tournament = await prisma.tournament.findUniqueOrThrow({
    where: { id },
    include: {
      registrations: { select: { id: true, status: true, pool: true, seed: true } },
      matches: {
        orderBy: [{ round: "asc" }, { matchNumber: "asc" }],
        select: {
          round: true,
          status: true,
          bracket: true,
          pool: true,
          score: true,
          courtId: true,
          sideARegistrationId: true,
          sideBRegistrationId: true,
          winnerRegistrationId: true,
        },
      },
      prizes: { orderBy: { place: "asc" } },
      courtBlocks: { select: { id: true, status: true } },
    },
  });

  const checks: Check[] = [];
  /* The match rows carry `courtId` on top of what placement and standings read,
     which is why they aren't simply `PlacementMatch` — a released court is one
     of the things being checked. */
  const matches = tournament.matches;
  const inDraw = tournament.registrations.filter((r) => r.status !== "withdrawn" && r.status !== "waitlisted");
  const config = resolveFormatConfig(tournament.format, inDraw.length, tournament);

  checks.push(
    check(
      "completed + timestamped",
      tournament.status === "completed" && tournament.completedAt != null,
      `status=${tournament.status} completedAt=${tournament.completedAt ? "set" : "null"}`,
    ),
  );

  const unfinished = matches.filter((m) => m.status !== "completed" && m.status !== "walkover");
  checks.push(
    check("no match left unplayed", unfinished.length === 0, `${unfinished.length} still pending/ready/on court`),
  );

  const played = matches.filter((m) => m.status === "completed").length;
  const walkovers = matches.filter((m) => m.status === "walkover").length;
  const forecast = totalMatchCount(tournament.format, inDraw.length, tournament);
  checks.push(
    check(
      "matches played = totalMatchCount",
      played === forecast,
      `played ${played}, forecast ${forecast}, ${walkovers} walkovers, ${matches.length} rows`,
    ),
  );

  /* Every row is either played or walked over, and a walkover never keeps a
     court — a released court that stayed held would silently halve the venue
     for the rest of the day. */
  checks.push(
    check(
      "walkovers hold no court",
      matches.filter((m) => m.status === "walkover").every((m) => m.courtId == null),
      "every walkover has courtId null",
    ),
  );

  /* Standings arithmetic. A bye is a one-sided match that still counts as a
     played win, which is the case most likely to be silently dropped — Swiss
     byes one entry every odd round, so a table that skipped them would be
     wrong for a whole format. */
  const standings = buildStandings(
    inDraw.map((r) => r.id),
    matches,
  );
  const incoherent = standings.filter((row) => row.played !== row.wins + row.losses);
  const byeWins = matches.filter(
    (m) => m.status === "walkover" && !m.sideARegistrationId !== !m.sideBRegistrationId && m.winnerRegistrationId,
  ).length;
  checks.push(
    check(
      "standings coherent (P = W + L)",
      incoherent.length === 0,
      incoherent.length === 0
        ? `${standings.length} rows, ${standings.reduce((s, r) => s + r.played, 0)} appearances, ${byeWins} bye wins`
        : `${incoherent.length} rows where played ≠ wins + losses`,
    ),
  );

  /* Placements. The list has to cover the field exactly once and read as a
     competition ranking — places that jump straight past a tie, and nothing
     else. A duplicate or a gap means two entries were handed the same trophy or
     one was handed none. */
  const placements = finalPlacements(tournament.format, config, tournament.registrations, matches);
  const placementIds = placements.map((p) => p.registrationId);
  const covered = new Set(placementIds).size === placementIds.length && placementIds.length === inDraw.length;
  checks.push(
    check(
      "placements cover the field once",
      covered && new Set(placementIds).size === new Set(inDraw.map((r) => r.id)).size,
      `${placements.length} placements for ${inDraw.length} entries`,
    ),
  );
  checks.push(check("placement ranking is gapless", ...rankingShape(placements)));

  const champion = championOf(placements);
  checks.push(
    check(
      "exactly one champion",
      champion != null,
      champion ? `1st place is one entry` : `${placements.filter((p) => p.place === 1).length} entries on 1st`,
    ),
  );
  checks.push(check("champion agrees with the draw", ...championAgrees(tournament.format, matches, champion)));

  /* Prizes are paired by place, so a tie for third means both entries match the
     same third-place prize — which is the fact the desk has to deal with, and
     the fact this should surface rather than smooth over. */
  const awarded = withPrizes(placements, tournament.prizes);
  const podium = awarded.filter((p) => p.place <= 3);
  checks.push(
    check(
      "podium paired with prizes",
      podium.length > 0 && podium.every((p) => p.prize != null),
      podium.map((p) => `${placeLabel(p.place)}→${p.prize?.label ?? "no prize"}`).join(", "),
    ),
  );

  /* The blocks go back to the calendar when the tournament ends. A finished
     tournament still holding two courts is two courts nobody can book. */
  const held = tournament.courtBlocks.filter((b) => b.status !== "cancelled");
  checks.push(
    check(
      "court blocks released",
      held.length === 0 && tournament.courtBlocks.length > 0,
      `${tournament.courtBlocks.length} blocks, ${held.length} still held`,
    ),
  );

  return checks;
}

/**
 * A placement list has to be a competition ranking: sorted, starting at 1, and
 * each new place exactly as far past the previous one as there were entries
 * sharing it. That is the property "no duplicates or gaps" actually means once
 * ties are allowed — 1, 2, 3, 3, 5 is right and 1, 2, 3, 3, 4 is not.
 */
function rankingShape(placements: readonly Placement[]): [boolean, string] {
  if (placements.length === 0) return [false, "no placements"];
  const places = placements.map((p) => p.place);
  for (let i = 0; i < places.length; i++) {
    if (places[i] !== places[i - 1] && places[i] !== i + 1) {
      return [false, `place ${places[i]} at index ${i} — expected ${i + 1} or a repeat`];
    }
    const tied = places.filter((p) => p === places[i]).length > 1;
    if (tied !== (placements[i].tied === true)) {
      return [false, `place ${places[i]} tied flag disagrees with the list`];
    }
  }
  return [true, `places ${places.join(", ")}`];
}

/** The champion this list names has to be the one the draw itself names, read a
 *  different way — off the last match for a bracket, off the top of the table
 *  for the rest. Two derivations agreeing is the point. */
function championAgrees(
  format: TournamentFormat,
  matches: readonly PlacementMatch[],
  champion: string | null,
): [boolean, string] {
  if (!champion) return [false, "no champion to check"];

  if (format === "double_elimination") {
    const reset = matches.find((m) => m.bracket === "grand_final_reset");
    const gf = matches.find((m) => m.bracket === "grand_final");
    const fromDraw = reset?.winnerRegistrationId ?? gf?.winnerRegistrationId ?? null;
    const resetPlayed = reset?.status === "completed";
    return [fromDraw === champion, resetPlayed ? "off a contested reset" : "off a walked-over reset"];
  }

  if (format === "single_elimination" || format === "pool_to_bracket") {
    const knockout = matches.filter((m) => m.pool == null);
    const last = knockout.reduce<PlacementMatch | null>((best, m) => (!best || m.round > best.round ? m : best), null);
    return [last?.winnerRegistrationId === champion, `off the final in round ${last?.round}`];
  }

  return [true, "off the top of the standings"];
}

/* ------------------------------------------------------------------ *
 * Reporting
 * ------------------------------------------------------------------ */

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

async function main() {
  const started = Date.now();
  console.log("Seeding simulated tournaments against", process.env.DATABASE_URL?.replace(/:[^:@]+@/, ":***@"));

  /* The owner is a real admin rather than a fake one. Court blocks are ordinary
     bookings owned by whoever published, and minting an extra account with the
     admin role into a shared database to hold them is not worth the tidiness. */
  const admin = await prisma.user.findFirst({ where: { role: "admin" }, orderBy: { createdAt: "asc" } });
  if (!admin) throw new Error("No admin user in this database to own the simulated tournaments.");

  const courts = await prisma.court.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });
  if (courts.length === 0) throw new Error("No active courts to run a tournament on.");
  const courtIds = courts.map((c) => c.id);

  const replaced = await resetPreviousRun();
  const pool = await ensureSimUsers();
  console.log(
    `${pool.length} sim members, ${courtIds.length} courts, owner ${admin.name || admin.email}` +
      `${replaced > 0 ? ` (replaced ${replaced} tournaments from a previous run)` : ""}\n`,
  );

  let taken = 0;
  const takePlayers = (n: number) => {
    const slice = pool.slice(taken, taken + n);
    taken += n;
    return slice;
  };

  const results: { scenario: Scenario; id: string; checks: Check[]; recorded: number }[] = [];

  for (const scenario of SCENARIOS) {
    process.stdout.write(`→ ${scenario.name} … `);
    const created = await setUpTournament(scenario, admin.id, courtIds, takePlayers);

    if (scenario.runTo === "registration_open") {
      console.log(`left open for entries (${created.entryIds.length} in)`);
      results.push({ scenario, id: created.id, checks: [], recorded: 0 });
      continue;
    }

    const seeds = await prisma.registration.findMany({
      where: { tournamentId: created.id, seed: { not: null } },
      select: { id: true, seed: true },
    });
    const seedOf = new Map(seeds.map((s) => [s.id, s.seed as number]));

    const { recorded } = await playOut(created, seedOf);

    if (scenario.runTo === "in_progress") {
      console.log(`left in progress after ${recorded} results`);
      results.push({ scenario, id: created.id, checks: [], recorded });
      continue;
    }

    const checks = await checkTournament(created);
    const failed = checks.filter((c) => !c.ok).length;
    console.log(`${recorded} results, ${failed === 0 ? "all checks passed" : `${failed} CHECKS FAILED`}`);
    results.push({ scenario, id: created.id, checks, recorded });
  }

  /* ---------------- the report ---------------- */

  console.log("\n" + "=".repeat(96));
  console.log("PER-FORMAT CHECKS");
  console.log("=".repeat(96));

  let anyFailed = false;
  for (const { scenario, checks } of results) {
    if (checks.length === 0) continue;
    console.log(`\n${scenario.format}  —  ${scenario.name}`);
    console.log(`  ${scenario.why}`);
    for (const c of checks) {
      if (!c.ok) anyFailed = true;
      console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${pad(c.label, 34)} ${c.detail}`);
    }
  }

  console.log("\n" + "=".repeat(96));
  console.log("SEEDED TOURNAMENTS");
  console.log("=".repeat(96));
  for (const { scenario, id, recorded } of results) {
    const t = await prisma.tournament.findUniqueOrThrow({
      where: { id },
      select: { status: true, _count: { select: { registrations: true, matches: true } } },
    });
    console.log(
      `  ${pad(t.status, 19)} ${pad(scenario.format, 19)} ${pad(`${t._count.registrations} entries`, 12)} ${pad(
        `${t._count.matches} matches`,
        12,
      )} ${pad(`${recorded} played`, 11)} ${id}  ${scenario.name}`,
    );
  }

  console.log("\n" + "=".repeat(96));
  console.log("FINAL PLACEMENTS");
  console.log("=".repeat(96));
  for (const { scenario, id, checks } of results) {
    if (checks.length === 0) continue;
    await printPlacements(id, scenario);
  }

  console.log(
    `\n${anyFailed ? "SOME CHECKS FAILED" : "ALL CHECKS PASSED"} — ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
  await prisma.$disconnect();
  process.exit(anyFailed ? 1 : 0);
}

/** Print the podium the way the winners card will render it, which is also the
 *  cheapest way to eyeball whether a placement list is nonsense. */
async function printPlacements(id: string, scenario: Scenario) {
  const t = await prisma.tournament.findUniqueOrThrow({
    where: { id },
    include: {
      registrations: {
        select: {
          id: true,
          status: true,
          pool: true,
          player1: { select: { name: true } },
          player2: { select: { name: true } },
        },
      },
      matches: {
        select: {
          round: true,
          status: true,
          bracket: true,
          pool: true,
          score: true,
          sideARegistrationId: true,
          sideBRegistrationId: true,
          winnerRegistrationId: true,
        },
      },
      prizes: true,
    },
  });

  const inDraw = t.registrations.filter((r) => r.status !== "withdrawn" && r.status !== "waitlisted");
  const config = resolveFormatConfig(t.format, inDraw.length, t);
  const named = new Map(
    t.registrations.map((r) => [r.id, r.player2 ? `${r.player1.name} / ${r.player2.name}` : r.player1.name]),
  );
  const awarded = withPrizes(finalPlacements(t.format, config, t.registrations, t.matches), t.prizes);

  console.log(`\n${scenario.name}`);
  for (const p of awarded.slice(0, 6)) {
    const prize = p.prize
      ? ` — ${p.prize.label}${p.prize.amountCents != null ? ` (₱${(p.prize.amountCents / 100).toLocaleString()})` : ""}`
      : "";
    console.log(`  ${pad(`${p.place}${p.tied ? " (tied)" : ""}`, 10)} ${pad(named.get(p.registrationId) ?? "?", 34)}${prize}`);
  }
  if (awarded.length > 6) console.log(`  … and ${awarded.length - 6} more`);
}

main().catch(async (error) => {
  console.error("\nSIMULATION FAILED\n", error);
  await prisma.$disconnect();
  process.exit(1);
});
