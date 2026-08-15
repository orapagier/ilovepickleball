import type {
  MatchBracket,
  MatchStatus,
  TournamentFormat,
  TournamentPlayType,
  TournamentStatus,
} from "@/generated/prisma/enums";

/**
 * Everything about running a tournament that doesn't touch the database:
 * bracket shape, the round-robin draw, the two-court running order, the
 * per-status edit rules, and standings. Kept pure so the server actions in
 * `src/lib/actions/tournament-actions.ts` stay thin, and so the parts that are
 * easy to get subtly wrong (bye placement, who may play next) can be reasoned
 * about on their own.
 */

/** Round robin is `entries × (entries − 1) / 2` matches; past this many entries
 *  that stops fitting in a day on two courts. Single elimination is `entries − 1`
 *  and needs no such cap. */
export const MAX_ROUND_ROBIN_ENTRIES = 8;

/** The same arithmetic, applied to one pool. Pools are the answer to a field
 *  too big to round-robin whole, so each pool has to stay small enough to
 *  actually play — six entries is already 15 matches in that pool alone. */
export const MAX_POOL_SIZE = 6;

/** A draw needs two entries to be a draw at all. */
export const MIN_TOURNAMENT_ENTRIES = 2;

/* ------------------------------------------------------------------ *
 * Format-specific shape
 * ------------------------------------------------------------------ */

/**
 * The knobs that only some formats have: how a `pool_to_bracket` field is
 * divided and how many come out of each pool, and how many rounds a `swiss`
 * draw plays. Stored nullable on `Tournament` — null means "whatever suits this
 * field size", resolved here so the default lives in one place.
 */
export type FormatConfig = {
  poolCount: number;
  advancePerPool: number;
  swissRounds: number;
};

export type FormatConfigInput = {
  poolCount?: number | null;
  advancePerPool?: number | null;
  swissRounds?: number | null;
};

/**
 * How many rounds a Swiss draw needs to separate a field: enough that the
 * unbeaten count halves down to one, which is `ceil(log2(entries))`. Fewer and
 * several entries finish unbeaten with no way to rank them.
 */
export function defaultSwissRounds(entries: number): number {
  if (entries < MIN_TOURNAMENT_ENTRIES) return 0;
  return Math.max(1, Math.ceil(Math.log2(entries)));
}

/**
 * How many pools to cut a field into: as few as possible while keeping each
 * pool inside `MAX_POOL_SIZE`, because a bigger pool means a truer table.
 *
 * Never one, given a field that can be split — a single pool would make this
 * format a round robin with a final bolted on, which is not what an admin
 * choosing "pools into knockout" is asking for.
 */
export function defaultPoolCount(entries: number): number {
  if (entries < MIN_TOURNAMENT_ENTRIES) return 1;
  return Math.max(entries >= MIN_TOURNAMENT_ENTRIES * 2 ? 2 : 1, Math.ceil(entries / MAX_POOL_SIZE));
}

export function resolveFormatConfig(
  format: TournamentFormat,
  entries: number,
  input?: FormatConfigInput | null,
): FormatConfig {
  const poolCount = clampPoolCount(input?.poolCount ?? defaultPoolCount(entries), entries);
  // Two per pool is the usual: it makes the knockout a power of two whenever
  // the pool count is, and it means finishing second in your pool still gets
  // you out of it.
  const maxAdvance = Math.max(1, Math.floor(entries / poolCount));
  const advancePerPool = Math.min(Math.max(1, input?.advancePerPool ?? 2), maxAdvance);
  const swissRounds = Math.max(1, Math.min(input?.swissRounds ?? defaultSwissRounds(entries), maxSwissRounds(entries)));
  return { poolCount, advancePerPool, swissRounds };
}

/** Every pool needs two entries, and a single pool is just a round robin. */
function clampPoolCount(requested: number, entries: number): number {
  const most = Math.max(1, Math.floor(entries / MIN_TOURNAMENT_ENTRIES));
  return Math.max(1, Math.min(requested, most));
}

/** A Swiss draw can't run more rounds than there are distinct opponents, or it
 *  would have to repeat a pairing. */
export function maxSwissRounds(entries: number): number {
  return Math.max(1, entries - 1);
}

/** Fallbacks for the pacing figures, used only when neither the facility
 *  setting nor a tournament override supplies one. `Setting` seeds from these. */
export const AVERAGE_MATCH_MINUTES = 25;
export const COURT_CHANGEOVER_MINUTES = 5;

/**
 * How long a match ties up a court, and how long it takes to turn one over.
 * These size the calendar block and nothing else — the running order on the day
 * is always the live queue.
 *
 * Resolved from three places, most specific first: this tournament's own
 * override, the facility default on `Setting`, then the constants above. A
 * tournament sets one when its format plays faster or slower than the house
 * average; most never do.
 */
export type Pacing = { matchMinutes: number; changeoverMinutes: number };

export function resolvePacing(
  tournament?: { averageMatchMinutes: number | null; courtChangeoverMinutes: number | null } | null,
  settings?: { averageMatchMinutes: number; courtChangeoverMinutes: number } | null,
): Pacing {
  return {
    matchMinutes: tournament?.averageMatchMinutes ?? settings?.averageMatchMinutes ?? AVERAGE_MATCH_MINUTES,
    changeoverMinutes:
      tournament?.courtChangeoverMinutes ?? settings?.courtChangeoverMinutes ?? COURT_CHANGEOVER_MINUTES,
  };
}

export const FORMAT_LABELS: Record<TournamentFormat, string> = {
  single_elimination: "Single elimination",
  round_robin: "Round robin",
  double_elimination: "Double elimination",
  pool_to_bracket: "Pools into knockout",
  swiss: "Swiss",
};

/** One line an admin can read before committing a field to a format. */
export const FORMAT_BLURBS: Record<TournamentFormat, string> = {
  single_elimination: "One loss and you're out. The shortest day for a given field.",
  round_robin: "Everybody plays everybody. The fairest table, and by far the most matches.",
  double_elimination:
    "Two losses to go out. The losers bracket gives everyone a second life, and the winners-bracket champion is twice to beat in the final.",
  pool_to_bracket: "Round-robin pools first, then the top finishers of each pool into a knockout.",
  swiss: "A fixed number of rounds paired by record. Nobody is eliminated, and the field size barely changes the length.",
};

export const BRACKET_LABELS: Record<MatchBracket, string> = {
  winners: "Winners bracket",
  losers: "Losers bracket",
  grand_final: "Grand final",
  grand_final_reset: "Grand final reset",
};

export const PLAY_TYPE_LABELS: Record<TournamentPlayType, string> = {
  singles: "Singles",
  doubles: "Doubles",
};

export const TOURNAMENT_STATUS_LABELS: Record<TournamentStatus, string> = {
  draft: "Draft",
  registration_open: "Registration open",
  registration_closed: "Registration closed",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const MATCH_STATUS_LABELS: Record<MatchStatus, string> = {
  pending: "Waiting on players",
  ready: "In the queue",
  in_progress: "On court",
  completed: "Final",
  walkover: "Walkover",
};

/* ------------------------------------------------------------------ *
 * Match counts and the calendar estimate
 * ------------------------------------------------------------------ */

export function totalMatchCount(
  format: TournamentFormat,
  entries: number,
  config?: FormatConfigInput | null,
): number {
  return matchesPerRound(format, entries, config).reduce((sum, m) => sum + m, 0);
}

/** How many entries survive the pools and contest the knockout. */
export function bracketFieldSize(entries: number, config: FormatConfig): number {
  return Math.min(entries, config.poolCount * config.advancePerPool);
}

/**
 * How many entries end up in each pool.
 *
 * Counted from the draw itself rather than divided out again: the snake in
 * `assignPools` doesn't put the spare entries in the pools a plain division
 * would, and an estimate built on a different split than the one that gets
 * played is an estimate of the wrong tournament.
 */
export function poolSizes(entries: number, poolCount: number): number[] {
  const pools = Math.max(1, poolCount);
  const counts = Array.from({ length: pools }, () => 0);
  for (const pool of assignPools(entries, pools)) counts[pool] += 1;
  return counts;
}

/** Rounds a round robin of this size takes, and how many matches are in each —
 *  one circle turn per round, minus whoever sits out an odd field. */
function roundRobinShape(entries: number): number[] {
  if (entries < MIN_TOURNAMENT_ENTRIES) return [];
  const rounds = entries % 2 === 0 ? entries - 1 : entries;
  return Array.from({ length: rounds }, () => Math.floor(entries / 2));
}

/** Matches in each round of a single-elimination draw of `entries`.
 *
 *  The first round is the odd one: padding to a power of two means most of its
 *  slots can be byes, so only `entries − size/2` of them are real matches.
 *  Every round after that is full, because the byes have already been absorbed. */
function singleEliminationShape(entries: number): number[] {
  if (entries < MIN_TOURNAMENT_ENTRIES) return [];
  const size = bracketSize(entries);
  const rounds = Math.log2(size);
  const perRound = [entries - size / 2];
  for (let r = 2; r <= rounds; r++) perRound.push(size / 2 ** r);
  return perRound;
}

/**
 * How many matches each round of a draw actually plays.
 *
 * A round here is a set of matches that can all run at once — nobody appears
 * twice in one — which is what makes it both the scheduling unit and the unit
 * the day-length estimate counts in. For the formats whose draw is known up
 * front this is arithmetic; for double elimination the rounds come from the
 * plan itself, because the losers bracket interleaves with the winners bracket
 * and the round numbering falls out of the dependencies rather than a formula.
 */
export function matchesPerRound(
  format: TournamentFormat,
  entries: number,
  config?: FormatConfigInput | null,
): number[] {
  if (entries < MIN_TOURNAMENT_ENTRIES) return [];
  const resolved = resolveFormatConfig(format, entries, config);

  switch (format) {
    case "round_robin":
      return roundRobinShape(entries);

    case "swiss":
      // Every round pairs the whole field at once; an odd field byes one entry.
      return Array.from({ length: resolved.swissRounds }, () => Math.floor(entries / 2));

    case "double_elimination": {
      const plan = buildDoubleEliminationPlan(entries);
      const rounds = plan.length === 0 ? 0 : Math.max(...plan.map((m) => m.round));
      // The reset is counted here because the block has to be long enough for
      // the day where it is played; most days it is walked over in a moment.
      return Array.from({ length: rounds }, (_, i) => plan.filter((m) => m.round === i + 1).length);
    }

    case "pool_to_bracket": {
      const sizes = poolSizes(entries, resolved.poolCount);
      const shapes = sizes.map(roundRobinShape);
      const poolRounds = Math.max(0, ...shapes.map((s) => s.length));
      // Pools run side by side, so a pool-stage round is every pool's matches
      // for that round taken together.
      const pools = Array.from({ length: poolRounds }, (_, r) =>
        shapes.reduce((sum, shape) => sum + (shape[r] ?? 0), 0),
      );
      return [...pools, ...singleEliminationShape(bracketFieldSize(entries, resolved))];
    }

    default:
      return singleEliminationShape(entries);
  }
}

/**
 * How many waves of play the courts have to run — the number that actually
 * decides how long a tournament takes.
 *
 * Dividing total matches by court count is the tempting answer and it is wrong:
 * a bracket round can't start until the round feeding it has finished, so the
 * closing rounds run one or two matches with the other court standing idle. An
 * 8-draw is 7 matches, which looks like 3.5 court-hours across two courts, but
 * it is really 4 waves — 4 matches, then 2, then 1 — and the last two waves
 * each use half the facility.
 *
 * A round robin has no such dependency between rounds, but it has the same
 * ceiling inside one: an entry can't be on two courts at once, so a round is
 * still at most `entries / 2` matches wide.
 */
export function playWaves(
  format: TournamentFormat,
  entries: number,
  courtCount: number,
  config?: FormatConfigInput | null,
): number {
  const courts = Math.max(1, courtCount);
  return matchesPerRound(format, entries, config).reduce((sum, m) => sum + Math.ceil(m / courts), 0);
}

/** Minutes of court time a draw of this shape needs, start to trophy. */
export function estimateMinutes(
  format: TournamentFormat,
  entries: number,
  courtCount: number,
  pacing: Pacing = resolvePacing(),
  config?: FormatConfigInput | null,
): number {
  const waves = playWaves(format, entries, courtCount, config);
  // An empty draw still holds the courts for an hour — the admin blocked them
  // for a reason, and a zero-length block would read as no block at all.
  return Math.max(60, waves * (pacing.matchMinutes + pacing.changeoverMinutes));
}

/**
 * How long to block the courts for. An estimate, but a structural one rather
 * than an average: it follows the draw's critical path, so it doesn't quietly
 * under-book a big bracket whose closing rounds can only use one court.
 *
 * It still assumes matches run to time. A day that overruns is handled by the
 * admin extending the block, not by a more elaborate formula here.
 */
export function estimateEndAt(params: {
  startAt: Date;
  format: TournamentFormat;
  entries: number;
  courtCount: number;
  pacing?: Pacing;
  config?: FormatConfigInput | null;
}): Date {
  const { startAt, format, entries, courtCount, pacing, config } = params;
  return new Date(startAt.getTime() + estimateMinutes(format, entries, courtCount, pacing, config) * 60_000);
}

/* ------------------------------------------------------------------ *
 * Seeding
 * ------------------------------------------------------------------ */

/** Fisher-Yates over a copy. `rand` is injectable so a test can pin the draw. */
export function shuffle<T>(items: readonly T[], rand: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Smallest power of two that fits `n` entries, minimum 2. */
export function bracketSize(n: number): number {
  let size = 2;
  while (size < n) size *= 2;
  return size;
}

/**
 * Standard bracket seeding order: the seed number that belongs in each slot of
 * a `size`-slot first round, so seed 1 and seed 2 can only meet in the final
 * and the byes (seed numbers above the real entry count) land on the top seeds.
 * For size 8 this is [1, 8, 4, 5, 2, 7, 3, 6].
 */
export function bracketSeedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const paired = order.length * 2;
    const next: number[] = [];
    for (const seed of order) {
      next.push(seed, paired + 1 - seed);
    }
    order = next;
  }
  return order;
}

/* ------------------------------------------------------------------ *
 * Bracket / draw generation
 * ------------------------------------------------------------------ */

export type PlannedMatch = {
  round: number;
  matchNumber: number;
  /** Index into the seeded entry list; null is a bye (round 1) or a slot the
   *  bracket hasn't decided yet (later rounds). */
  sideAIndex: number | null;
  sideBIndex: number | null;
  /** Where this match's winner goes — null in a round-robin draw and in a final. */
  nextRound: number | null;
  nextMatchNumber: number | null;
  nextSlot: "A" | "B" | null;
  /** Where this match's *loser* goes. Double elimination only: one match feeds
   *  two others there, which a single winner edge can't express. */
  loserNextRound: number | null;
  loserNextMatchNumber: number | null;
  loserNextSlot: "A" | "B" | null;
  bracket: MatchBracket | null;
  /** 1-based pool number for a pool-stage match, null everywhere else. */
  pool: number | null;
};

/** A `PlannedMatch` with nothing filled in, so a builder only states what it
 *  actually means. */
const EMPTY_PLANNED: Omit<PlannedMatch, "round" | "matchNumber"> = {
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
};

/* ------------------------------------------------------------------ *
 * Laying a draw out in rounds
 * ------------------------------------------------------------------ */

type PlanEdge = { key: string; slot: "A" | "B" };

/**
 * A match in a draw before its round is known: identified by key, pointing at
 * other keys. Used by the builders whose round numbering isn't obvious by
 * inspection — chiefly double elimination, where the losers bracket interleaves
 * with the winners bracket.
 */
type PlanNode = {
  key: string;
  bracket?: MatchBracket | null;
  pool?: number | null;
  sideAIndex?: number | null;
  sideBIndex?: number | null;
  winnerTo?: PlanEdge | null;
  loserTo?: PlanEdge | null;
  /** Forces a round rather than deriving one — for a stage whose rounds are a
   *  schedule (the circle turns of a pool) and not a dependency chain. */
  fixedRound?: number;
  /** Sort key within a round, so match numbers come out in a readable order. */
  order: number;
};

/**
 * Turn keyed nodes into rounds.
 *
 * A match's round is one past the last round it depends on, which makes a round
 * exactly "the matches that can be played once everything before them is done".
 * That is the property the rest of the system leans on: nobody appears twice in
 * a round, so a round is both the unit the day-length estimate counts in and
 * the unit an admin can put in a window of play.
 */
function layoutPlan(nodes: readonly PlanNode[]): PlannedMatch[] {
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const sources = new Map<string, string[]>();
  for (const node of nodes) {
    for (const edge of [node.winnerTo, node.loserTo]) {
      if (!edge) continue;
      const list = sources.get(edge.key) ?? [];
      list.push(node.key);
      sources.set(edge.key, list);
    }
  }

  const depths = new Map<string, number>();
  const resolving = new Set<string>();
  const depthOf = (key: string): number => {
    const cached = depths.get(key);
    if (cached != null) return cached;
    const node = byKey.get(key);
    if (!node) return 1;
    // A cycle would be a bug in a builder, not something to hang on.
    if (resolving.has(key)) return 1;
    resolving.add(key);
    const feeders = sources.get(key) ?? [];
    const depth = Math.max(node.fixedRound ?? 1, ...feeders.map((f) => depthOf(f) + 1));
    resolving.delete(key);
    depths.set(key, depth);
    return depth;
  };

  const placed = nodes
    .map((node) => ({ node, round: depthOf(node.key) }))
    .sort((a, b) => a.round - b.round || a.node.order - b.node.order);

  // Match numbers restart in every round, which is what the bracket UI and the
  // queue tiebreak both read.
  const position = new Map<string, { round: number; matchNumber: number }>();
  const counters = new Map<number, number>();
  for (const { node, round } of placed) {
    const matchNumber = (counters.get(round) ?? 0) + 1;
    counters.set(round, matchNumber);
    position.set(node.key, { round, matchNumber });
  }

  return placed.map(({ node, round }) => {
    const self = position.get(node.key)!;
    const winner = node.winnerTo ? position.get(node.winnerTo.key) : undefined;
    const loser = node.loserTo ? position.get(node.loserTo.key) : undefined;
    return {
      ...EMPTY_PLANNED,
      round,
      matchNumber: self.matchNumber,
      sideAIndex: node.sideAIndex ?? null,
      sideBIndex: node.sideBIndex ?? null,
      nextRound: winner?.round ?? null,
      nextMatchNumber: winner?.matchNumber ?? null,
      nextSlot: winner ? node.winnerTo!.slot : null,
      loserNextRound: loser?.round ?? null,
      loserNextMatchNumber: loser?.matchNumber ?? null,
      loserNextSlot: loser ? node.loserTo!.slot : null,
      bracket: node.bracket ?? null,
      pool: node.pool ?? null,
    };
  });
}

/**
 * Every match of a single-elimination bracket, wired for advancement. Entries
 * are given by index into an already-seeded list (seed 1 first). The draw is
 * padded to a power of two with byes; a bye is a round-1 match with one side
 * null, which the caller completes as a walkover so the real entry advances
 * without a court ever being used.
 */
export function buildSingleEliminationPlan(entryCount: number): PlannedMatch[] {
  if (entryCount < MIN_TOURNAMENT_ENTRIES) return [];

  const size = bracketSize(entryCount);
  const rounds = Math.log2(size);
  const seedOrder = bracketSeedOrder(size);
  // Seed numbers past the real entry count are byes.
  const slotEntry = seedOrder.map((seed) => (seed <= entryCount ? seed - 1 : null));

  const plan: PlannedMatch[] = [];
  for (let round = 1; round <= rounds; round++) {
    const matchesInRound = size / 2 ** round;
    for (let matchNumber = 1; matchNumber <= matchesInRound; matchNumber++) {
      const isFinal = round === rounds;
      plan.push({
        ...EMPTY_PLANNED,
        round,
        matchNumber,
        sideAIndex: round === 1 ? slotEntry[(matchNumber - 1) * 2] : null,
        sideBIndex: round === 1 ? slotEntry[(matchNumber - 1) * 2 + 1] : null,
        nextRound: isFinal ? null : round + 1,
        nextMatchNumber: isFinal ? null : Math.ceil(matchNumber / 2),
        // Odd-numbered matches feed the top half of their parent, even the bottom.
        nextSlot: isFinal ? null : matchNumber % 2 === 1 ? "A" : "B",
      });
    }
  }
  return plan;
}

/**
 * Every pairing of a round robin, grouped into rounds by the circle method.
 *
 * Each turn of the circle is a round in which every entry plays at most once,
 * which is exactly the property that makes a round a schedulable unit — "round
 * 1 is Monday 8–10" only means something if round 1's matches don't share
 * players. There is still no advancement between them, so `nextRound` stays
 * null throughout; the round number is an ordering and a scheduling handle, not
 * a bracket position.
 */
export function buildRoundRobinPlan(entryCount: number): PlannedMatch[] {
  return roundRobinPairings(Array.from({ length: entryCount }, (_, i) => i)).map((m) => ({
    ...EMPTY_PLANNED,
    round: m.round,
    matchNumber: m.matchNumber,
    sideAIndex: m.a,
    sideBIndex: m.b,
  }));
}

/**
 * The circle method over an arbitrary set of entry indices, so it serves both a
 * whole-field round robin and one pool of a `pool_to_bracket` draw.
 *
 * Each turn of the circle is a round in which every entry plays at most once,
 * which is exactly the property that makes a round a schedulable unit — "round
 * 1 is Monday 8–10" only means something if round 1's matches don't share
 * players.
 */
function roundRobinPairings(
  indices: readonly number[],
): { round: number; matchNumber: number; a: number; b: number }[] {
  if (indices.length < MIN_TOURNAMENT_ENTRIES) return [];

  // An odd count gets a phantom entry (-1); whoever draws it sits out that turn
  // of the circle rather than playing.
  const circle: number[] = [...indices];
  if (circle.length % 2 === 1) circle.push(-1);

  const out: { round: number; matchNumber: number; a: number; b: number }[] = [];
  const half = circle.length / 2;

  for (let turn = 0; turn < circle.length - 1; turn++) {
    let matchNumber = 1;
    for (let i = 0; i < half; i++) {
      const a = circle[i];
      const b = circle[circle.length - 1 - i];
      if (a === -1 || b === -1) continue;
      out.push({ round: turn + 1, matchNumber: matchNumber++, a, b });
    }
    // Rotate everything but the first position — that's the circle method.
    circle.splice(1, 0, circle.pop() as number);
  }
  return out;
}

/**
 * Every match of a double-elimination draw, both brackets and the grand final.
 *
 * The winners bracket is an ordinary single-elimination draw. Every match in it
 * also drops its loser into the losers bracket, which alternates between two
 * kinds of round: a *minor* round pairing losers-bracket survivors against each
 * other, then a *major* round putting those winners against the entries that
 * have just dropped out of the winners bracket. That alternation is what keeps
 * the two brackets the same length.
 *
 * The winners-bracket entries arriving in a major round are taken in reverse
 * order. Without that reversal an entry could meet, in its first losers-bracket
 * match, the very opponent that put it there.
 *
 * The grand final is the winners-bracket champion against the losers-bracket
 * champion, and the winners-bracket champion is *twice to beat*: they arrive
 * with no losses, so if they lose the grand final the two are level at one loss
 * each and a reset match decides it. That match is planned like any other and
 * simply walked over when the grand final doesn't call for it.
 */
export function buildDoubleEliminationPlan(entryCount: number): PlannedMatch[] {
  if (entryCount < MIN_TOURNAMENT_ENTRIES) return [];

  const size = bracketSize(entryCount);
  const wbRounds = Math.log2(size);
  const seedOrder = bracketSeedOrder(size);
  const slotEntry = seedOrder.map((seed) => (seed <= entryCount ? seed - 1 : null));

  const nodes: PlanNode[] = [];
  const wb = (r: number, m: number) => `w${r}.${m}`;
  const lb = (r: number, m: number) => `l${r}.${m}`;
  const GF = "gf";
  const RESET = "gfr";
  /** Losers-bracket rounds. Two per winners round after the first; none at all
   *  when the whole draw is a single match. */
  const lbRounds = Math.max(0, 2 * wbRounds - 2);
  const lbRoundSize = (r: number) => size / 2 ** (Math.ceil(r / 2) + 1);

  for (let r = 1; r <= wbRounds; r++) {
    const count = size / 2 ** r;
    for (let m = 1; m <= count; m++) {
      const isWbFinal = r === wbRounds;
      nodes.push({
        key: wb(r, m),
        bracket: "winners",
        order: 1000 * r + m,
        sideAIndex: r === 1 ? slotEntry[(m - 1) * 2] : null,
        sideBIndex: r === 1 ? slotEntry[(m - 1) * 2 + 1] : null,
        winnerTo: isWbFinal
          ? { key: GF, slot: "A" }
          : { key: wb(r + 1, Math.ceil(m / 2)), slot: m % 2 === 1 ? "A" : "B" },
        loserTo:
          lbRounds === 0
            ? // A two-entry draw has no losers bracket: the only loser is the
              // one the grand final is against.
              { key: GF, slot: "B" }
            : r === 1
              ? { key: lb(1, Math.ceil(m / 2)), slot: m % 2 === 1 ? "A" : "B" }
              : // Into the major round fed by this winners round, reversed.
                { key: lb(2 * (r - 1), count - m + 1), slot: "B" },
      });
    }
  }

  for (let r = 1; r <= lbRounds; r++) {
    const count = lbRoundSize(r);
    const minor = r % 2 === 1;
    for (let m = 1; m <= count; m++) {
      const last = r === lbRounds;
      nodes.push({
        key: lb(r, m),
        bracket: "losers",
        order: 100_000 + 1000 * r + m,
        winnerTo: last
          ? { key: GF, slot: "B" }
          : minor
            ? // A minor round's winners simply move across into the major round
              // that pairs them with the incoming winners-bracket entries.
              { key: lb(r + 1, m), slot: "A" }
            : { key: lb(r + 1, Math.ceil(m / 2)), slot: m % 2 === 1 ? "A" : "B" },
      });
    }
  }

  nodes.push({
    key: GF,
    bracket: "grand_final",
    order: 900_000,
    winnerTo: { key: RESET, slot: "A" },
  });
  nodes.push({ key: RESET, bracket: "grand_final_reset", order: 900_001 });

  return layoutPlan(nodes);
}

/** Which pool each seeded entry lands in, 0-based, snaked so the strongest
 *  entries are spread across pools rather than stacked into the first one. */
export function assignPools(entryCount: number, poolCount: number): number[] {
  const pools = Math.max(1, poolCount);
  return Array.from({ length: entryCount }, (_, i) => {
    const lap = Math.floor(i / pools);
    const pos = i % pools;
    return lap % 2 === 0 ? pos : pools - 1 - pos;
  });
}

/**
 * The pool stage of a `pool_to_bracket` draw: a round robin inside each pool,
 * with every pool's round *n* sharing round *n* of the tournament so the pools
 * run alongside each other rather than one after another.
 *
 * The knockout that follows is deliberately not built here. Who plays in it
 * depends on the pool tables, which don't exist until the pools are played, so
 * those matches are created when the last pool match is recorded — see
 * `growDraw` in tournament-engine.ts.
 */
export function buildPoolStagePlan(entryCount: number, poolCount: number): PlannedMatch[] {
  if (entryCount < MIN_TOURNAMENT_ENTRIES) return [];

  const assignment = assignPools(entryCount, poolCount);
  const nodes: PlanNode[] = [];

  for (let pool = 0; pool < Math.max(1, poolCount); pool++) {
    const members = assignment.flatMap((p, i) => (p === pool ? [i] : []));
    for (const pairing of roundRobinPairings(members)) {
      nodes.push({
        key: `p${pool}.${pairing.round}.${pairing.matchNumber}`,
        pool: pool + 1,
        // The circle turn is the round; pools play theirs simultaneously.
        fixedRound: pairing.round,
        order: 1000 * pairing.round + 10 * pool + pairing.matchNumber,
        sideAIndex: pairing.a,
        sideBIndex: pairing.b,
      });
    }
  }

  return layoutPlan(nodes);
}

/**
 * The knockout that follows the pools, as a bracket over `fieldSize` entries
 * whose rounds start after `afterRound`.
 *
 * Its sides are filled from the pool tables by the caller, so every match here
 * starts empty — including the first round, which in a normal bracket would
 * already know who is in it.
 */
export function buildPoolKnockoutPlan(fieldSize: number, afterRound: number): PlannedMatch[] {
  return buildSingleEliminationPlan(fieldSize).map((m) => ({
    ...m,
    round: m.round + afterRound,
    nextRound: m.nextRound == null ? null : m.nextRound + afterRound,
    // The pool tables decide who is in round one, not a preceding match.
    sideAIndex: null,
    sideBIndex: null,
  }));
}

/**
 * The order the pool qualifiers are seeded into the knockout: every pool winner
 * first, then every runner-up, and so on.
 *
 * Combined with `bracketSeedOrder` this keeps two entries out of the same
 * round-one match when they have just spent the pool stage playing each other —
 * with two pools it produces winner-of-A against runner-up-of-B, which is the
 * pairing everyone expects.
 */
export function poolQualifierOrder(config: FormatConfig): { pool: number; place: number }[] {
  const out: { pool: number; place: number }[] = [];
  for (let place = 0; place < config.advancePerPool; place++) {
    for (let pool = 0; pool < config.poolCount; pool++) {
      out.push({ pool, place });
    }
  }
  return out;
}

export type Qualifier = { pool: number; place: number };

/**
 * The qualifiers laid into the knockout's first-round slots, in bracket order.
 * `null` is a bye, for the slots a field short of a power of two doesn't fill.
 *
 * Seeding them by `bracketSeedOrder` keeps the pool winners apart, but on its
 * own it does not stop two entries out of the *same* pool meeting in the
 * opening match — whether it does depends on the pool count and how many byes
 * there are, so no single ordering gets it right for every shape. Rather than
 * pick a formula that works for two pools and fails for three, this seeds and
 * then repairs: any opening match between pool-mates is swapped out, preferring
 * a swap between qualifiers who finished in the same place so the seeding stays
 * as true as it can.
 */
export function seedPoolQualifiers(config: FormatConfig, fieldSize: number): (Qualifier | null)[] {
  const qualifiers = poolQualifierOrder(config).slice(0, fieldSize);
  const size = bracketSize(Math.max(MIN_TOURNAMENT_ENTRIES, fieldSize));
  const slots: (Qualifier | null)[] = bracketSeedOrder(size).map((seed) => qualifiers[seed - 1] ?? null);

  const clashes = () => {
    const out: number[] = [];
    for (let i = 0; i + 1 < slots.length; i += 2) {
      const a = slots[i];
      const b = slots[i + 1];
      if (a && b && a.pool === b.pool) out.push(i);
    }
    return out;
  };

  // Bounded: every pass fixes one opening match, and there are only so many.
  for (let pass = 0; pass < slots.length; pass++) {
    const [clash] = clashes();
    if (clash == null) break;

    const partnerOf = (i: number) => (i % 2 === 0 ? i + 1 : i - 1);
    const candidates = slots
      .map((_, i) => i)
      .filter((i) => i !== clash && i !== clash + 1)
      // A swap between equal finishers disturbs the seeding least.
      .sort((x, y) => samePlaceRank(slots[x], slots[clash + 1]) - samePlaceRank(slots[y], slots[clash + 1]));

    const swap = candidates.find((i) => {
      const moving = slots[i];
      const leaving = slots[clash + 1];
      const movingPartner = slots[partnerOf(i)];
      const clashPartner = slots[clash];
      // Neither the pair we're fixing nor the pair we're borrowing from may end
      // up as pool-mates.
      const fixesClash = !moving || !clashPartner || moving.pool !== clashPartner.pool;
      const keepsOther = !leaving || !movingPartner || leaving.pool !== movingPartner.pool;
      return fixesClash && keepsOther;
    });
    if (swap == null) break;

    [slots[clash + 1], slots[swap]] = [slots[swap], slots[clash + 1]];
  }

  return slots;
}

/** 0 when both finished in the same place in their pools, 1 otherwise. */
function samePlaceRank(a: Qualifier | null, b: Qualifier | null): number {
  return a && b && a.place === b.place ? 0 : 1;
}

/**
 * Round one of a Swiss draw: the shuffled field paired straight down.
 *
 * Only the first round is planned. Every later round pairs on the standings the
 * earlier rounds produced, so it can't exist until they have been played — see
 * `pairSwissRound` and `growDraw`.
 */
export function buildSwissOpeningPlan(entryCount: number): PlannedMatch[] {
  if (entryCount < MIN_TOURNAMENT_ENTRIES) return [];
  return swissPairingsToPlan(pairSwissOpening(entryCount), 1);
}

function pairSwissOpening(entryCount: number): [number, number | null][] {
  const pairs: [number, number | null][] = [];
  for (let i = 0; i + 1 < entryCount; i += 2) pairs.push([i, i + 1]);
  // An odd field byes whoever is left; the engine walks that match over, which
  // records the free win the format intends.
  if (entryCount % 2 === 1) pairs.push([entryCount - 1, null]);
  return pairs;
}

function swissPairingsToPlan(pairs: readonly [number, number | null][], round: number): PlannedMatch[] {
  return pairs.map(([a, b], i) => ({
    ...EMPTY_PLANNED,
    round,
    matchNumber: i + 1,
    sideAIndex: a,
    sideBIndex: b,
  }));
}

/**
 * Pair the next Swiss round: entries in standings order, each taken with the
 * nearest one below it they haven't already played.
 *
 * Greedy alone is not enough. Taking the closest legal opponent at every step
 * can strand the last two entries as a pair that has already met, even when a
 * rematch-free pairing of the whole round exists — a six-entry draw hits it by
 * the third round. So this backtracks: if a choice leaves the rest of the field
 * unpairable, it takes the next-closest opponent instead.
 *
 * Preferring the nearest opponent is what keeps it Swiss — entries on the same
 * record play each other — and trying them in that order means the pairing it
 * settles on is the closest one that works, not merely one that works.
 */
export function pairSwissRound(params: {
  /** Registration ids in standings order, strongest first. */
  order: readonly string[];
  /** Every pair that has already met, as `a|b` with the ids sorted. */
  played: ReadonlySet<string>;
}): { a: string; b: string | null }[] {
  const field = [...params.order];
  const pairs: { a: string; b: string | null }[] = [];

  // The odd entry out takes the bye before pairing starts, so the search runs
  // over an even field. Standings order means that is whoever is currently
  // last, which is the convention.
  if (field.length % 2 === 1) {
    const bye = field.pop() as string;
    pairs.push({ a: bye, b: null });
  }

  const search = (remaining: readonly string[]): { a: string; b: string }[] | null => {
    if (remaining.length === 0) return [];
    const [a, ...rest] = remaining;
    for (let i = 0; i < rest.length; i++) {
      if (params.played.has(pairKey(a, rest[i]))) continue;
      const tail = search([...rest.slice(0, i), ...rest.slice(i + 1)]);
      if (tail) return [{ a, b: rest[i] }, ...tail];
    }
    return null;
  };

  const found = search(field);
  if (found) return [...found.map((p) => ({ a: p.a, b: p.b as string | null })), ...pairs];

  /* Every entry has now played every other, or the field is so tangled that no
     rematch-free round exists. A repeat pairing beats refusing to schedule the
     round; `maxSwissRounds` is what normally keeps a draw from getting here. */
  const fallback: { a: string; b: string | null }[] = [];
  for (let i = 0; i + 1 < field.length; i += 2) fallback.push({ a: field[i], b: field[i + 1] });
  return [...fallback, ...pairs];
}

/** Order-independent key for "these two have met". */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * The matches to create when a draw is first made.
 *
 * For most formats this is the whole tournament. For `pool_to_bracket` and
 * `swiss` it is only the part that can be known before anything is played —
 * those two grow as results come in.
 */
export function buildDrawPlan(
  format: TournamentFormat,
  entryCount: number,
  config?: FormatConfigInput | null,
): PlannedMatch[] {
  const resolved = resolveFormatConfig(format, entryCount, config);
  switch (format) {
    case "single_elimination":
      return buildSingleEliminationPlan(entryCount);
    case "round_robin":
      return buildRoundRobinPlan(entryCount);
    case "double_elimination":
      return buildDoubleEliminationPlan(entryCount);
    case "pool_to_bracket":
      return buildPoolStagePlan(entryCount, resolved.poolCount);
    case "swiss":
      return buildSwissOpeningPlan(entryCount);
  }
}

/** Whether a format's draw is complete the moment it is made, or grows as
 *  results arrive. */
export function drawGrows(format: TournamentFormat): boolean {
  return format === "pool_to_bracket" || format === "swiss";
}

/* ------------------------------------------------------------------ *
 * The two-court running order
 * ------------------------------------------------------------------ */

export type QueuedMatch = {
  id: string;
  round: number;
  matchNumber: number;
  sideARegistrationId: string | null;
  sideBRegistrationId: string | null;
};

export type LiveMatch = {
  courtId: number | null;
  sideARegistrationId: string | null;
  sideBRegistrationId: string | null;
};

/**
 * Which queued matches should take which courts right now.
 *
 * The whole running order is this one rule applied whenever a court frees up:
 * take the earliest queued match whose players aren't already on the other
 * court. That matters for round robin, where one entry appears in many
 * matches; an elimination bracket can't produce the clash by construction.
 *
 * Pure and idempotent — callers re-run it after every completion rather than
 * tracking a queue cursor.
 */
export function planCourtAssignments(params: {
  readyMatches: QueuedMatch[];
  liveMatches: LiveMatch[];
  courtIds: number[];
}): { matchId: string; courtId: number }[] {
  const { readyMatches, liveMatches, courtIds } = params;

  const occupiedCourts = new Set(liveMatches.map((m) => m.courtId).filter((id): id is number => id != null));
  const freeCourts = courtIds.filter((id) => !occupiedCourts.has(id));
  if (freeCourts.length === 0) return [];

  const busyEntries = new Set<string>();
  for (const m of liveMatches) {
    if (m.sideARegistrationId) busyEntries.add(m.sideARegistrationId);
    if (m.sideBRegistrationId) busyEntries.add(m.sideBRegistrationId);
  }

  const queue = [...readyMatches].sort((a, b) => a.round - b.round || a.matchNumber - b.matchNumber);
  const assignments: { matchId: string; courtId: number }[] = [];

  for (const courtId of freeCourts) {
    const next = queue.find(
      (m) =>
        // A match missing a side isn't playable yet whatever the queue says.
        m.sideARegistrationId != null &&
        m.sideBRegistrationId != null &&
        !busyEntries.has(m.sideARegistrationId) &&
        !busyEntries.has(m.sideBRegistrationId),
    );
    if (!next) break;

    assignments.push({ matchId: next.id, courtId });
    queue.splice(queue.indexOf(next), 1);
    if (next.sideARegistrationId) busyEntries.add(next.sideARegistrationId);
    if (next.sideBRegistrationId) busyEntries.add(next.sideBRegistrationId);
  }

  return assignments;
}

/* ------------------------------------------------------------------ *
 * Scores and standings
 * ------------------------------------------------------------------ */

/**
 * Total points either side took across every game in a free-text score like
 * "11-7, 11-9". Anything unparseable contributes nothing rather than failing —
 * the score is staff-entered prose, and a standings table is not worth
 * rejecting a result over.
 */
export function parseScoreTotals(score: string): { a: number; b: number } {
  let a = 0;
  let b = 0;
  for (const game of score.split(/[,;]/)) {
    const match = game.trim().match(/^(\d+)\s*[-–—:]\s*(\d+)$/);
    if (!match) continue;
    a += Number(match[1]);
    b += Number(match[2]);
  }
  return { a, b };
}

export type StandingRow = {
  registrationId: string;
  played: number;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  diff: number;
};

/**
 * Win-loss table for a round robin, sorted by wins then point differential —
 * the order the plan calls for. Walkovers count as a win and a loss but score
 * no points, so a no-show can't distort the differential tiebreak.
 */
export function buildStandings(
  registrationIds: readonly string[],
  matches: readonly {
    status: MatchStatus;
    score: string;
    sideARegistrationId: string | null;
    sideBRegistrationId: string | null;
    winnerRegistrationId: string | null;
  }[],
): StandingRow[] {
  const rows = new Map<string, StandingRow>(
    registrationIds.map((id) => [
      id,
      { registrationId: id, played: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, diff: 0 },
    ]),
  );

  for (const match of matches) {
    if (match.status !== "completed" && match.status !== "walkover") continue;
    const { sideARegistrationId: aId, sideBRegistrationId: bId } = match;
    const a = aId ? rows.get(aId) : undefined;
    const b = bId ? rows.get(bId) : undefined;

    /* A match with only one side is a bye: the entry that turned up gets the
       win, and there is nobody to give the loss to. Swiss byes an entry in
       every odd round, so dropping these would lose a real win from the table
       rather than merely tidying it. */
    if (!a !== !b) {
      const lone = a ?? b;
      if (lone && match.winnerRegistrationId === (a ? aId : bId)) {
        lone.played += 1;
        lone.wins += 1;
      }
      continue;
    }
    if (!a || !b) continue;

    a.played += 1;
    b.played += 1;
    if (match.winnerRegistrationId === aId) {
      a.wins += 1;
      b.losses += 1;
    } else if (match.winnerRegistrationId === bId) {
      b.wins += 1;
      a.losses += 1;
    }

    if (match.status === "completed") {
      const totals = parseScoreTotals(match.score);
      a.pointsFor += totals.a;
      a.pointsAgainst += totals.b;
      b.pointsFor += totals.b;
      b.pointsAgainst += totals.a;
    }
  }

  return [...rows.values()]
    .map((row) => ({ ...row, diff: row.pointsFor - row.pointsAgainst }))
    .sort((x, y) => y.wins - x.wins || y.diff - x.diff || y.pointsFor - x.pointsFor);
}

/* ------------------------------------------------------------------ *
 * Status rules (§4 of the plan)
 * ------------------------------------------------------------------ */

/** Every field an admin can send from the edit form. */
export type EditableField =
  | "name"
  | "description"
  | "format"
  | "playType"
  /** The min/max rating pair, together — they are one rule. */
  | "skillBand"
  | "maxEntries"
  | "minEntries"
  | "entryFeeCents"
  | "registrationOpensAt"
  | "registrationClosesAt"
  | "startAt"
  | "courtIds"
  | "prizeDescription"
  /** The two pacing overrides, together — they only resize the court block. */
  | "pacing"
  /** The pool and Swiss knobs, together. They decide the shape of the draw, so
   *  they lock alongside `format` rather than alongside `pacing`. */
  | "formatShape";

/**
 * What each status still lets an admin change. Enforced in the action, not just
 * hidden in the form — anything not listed for the current status is rejected
 * server-side. `completed` and `cancelled` are terminal and appear here as
 * empty sets on purpose.
 */
export const EDITABLE_BY_STATUS: Record<TournamentStatus, readonly EditableField[]> = {
  draft: [
    "name",
    "description",
    "format",
    "playType",
    "skillBand",
    "maxEntries",
    "minEntries",
    "entryFeeCents",
    "registrationOpensAt",
    "registrationClosesAt",
    "startAt",
    "courtIds",
    "prizeDescription",
    "pacing",
    "formatShape",
  ],
  // Fee changes apply to new registrants only, never retroactively; the close
  // date can be extended but not shortened; max entries raised but not cut
  // below the count already registered; and the opening date can be brought
  // forward or cleared but never pushed back, since that would take away a
  // window members can already see. All four are checked in the action.
  registration_open: [
    "name",
    "description",
    "entryFeeCents",
    "registrationOpensAt",
    "registrationClosesAt",
    "maxEntries",
    "prizeDescription",
    "pacing",
  ],
  // Day-of adjustments only: which courts, and when play starts. Pacing stays
  // open because it resizes the court block, which is exactly the kind of
  // day-of correction this stage is for.
  registration_closed: ["description", "courtIds", "startAt", "prizeDescription", "pacing"],
  in_progress: [],
  completed: [],
  cancelled: [],
};

export function isFieldEditable(status: TournamentStatus, field: EditableField): boolean {
  return EDITABLE_BY_STATUS[status].includes(field);
}

/** Statuses an admin can still cancel from — everything that isn't terminal. */
export function isCancellable(status: TournamentStatus): boolean {
  return status !== "completed" && status !== "cancelled";
}

/** How long a finished tournament's results stay before an admin may delete it.
 *  Long enough that anyone who wants the standings has had them. */
export const COMPLETED_RETENTION_DAYS = 30;

export type Deletability = { deletable: true } | { deletable: false; reason: string };

/**
 * Whether a tournament can be deleted outright.
 *
 * A cancelled one never happened, so it goes whenever an admin says. A finished
 * one is a record — of who won, who played, what the scores were — so it waits
 * out `COMPLETED_RETENTION_DAYS` first. Anything still live is refused: deleting
 * it would take a draw out from under the people in it.
 *
 * Export before you delete; nothing here is recoverable.
 */
export function tournamentDeletability(
  tournament: { status: TournamentStatus; completedAt: Date | null; updatedAt: Date },
  now: Date = new Date(),
): Deletability {
  if (tournament.status === "cancelled") return { deletable: true };

  if (tournament.status !== "completed") {
    return {
      deletable: false,
      reason: "Only cancelled or finished tournaments can be deleted — cancel this one first.",
    };
  }

  // Tournaments that finished before `completedAt` existed fall back to
  // `updatedAt`, which for a finished tournament is the status write itself.
  const finishedAt = tournament.completedAt ?? tournament.updatedAt;
  const days = (now.getTime() - finishedAt.getTime()) / 86_400_000;
  if (days < COMPLETED_RETENTION_DAYS) {
    const left = Math.max(1, Math.ceil(COMPLETED_RETENTION_DAYS - days));
    return {
      deletable: false,
      reason: `Finished tournaments are kept ${COMPLETED_RETENTION_DAYS} days — this one can be deleted in ${left} ${left === 1 ? "day" : "days"}.`,
    };
  }
  return { deletable: true };
}

/**
 * Whether a member can join right now. `registration_open` alone isn't enough:
 * a tournament published ahead of its `registrationOpensAt` is visible but not
 * yet joinable, and one past its close date is done taking entries even if the
 * close job hasn't run.
 */
export function isJoinable(
  tournament: { status: TournamentStatus; registrationOpensAt: Date | null; registrationClosesAt: Date },
  now: Date = new Date(),
): boolean {
  if (tournament.status !== "registration_open") return false;
  if (tournament.registrationOpensAt && now < tournament.registrationOpensAt) return false;
  return now < tournament.registrationClosesAt;
}

/**
 * Published, listed, and still not joinable — its `registrationOpensAt` hasn't
 * arrived. Worth its own predicate because the status is `registration_open`
 * throughout, so nothing else distinguishes "open for entries" from "waiting to
 * be", and calling both of them the same thing in the UI reads as a bug.
 */
export function isAwaitingRegistrationOpen(
  tournament: { status: TournamentStatus; registrationOpensAt: Date | null },
  now: Date = new Date(),
): boolean {
  return (
    tournament.status === "registration_open" &&
    tournament.registrationOpensAt != null &&
    now < tournament.registrationOpensAt
  );
}

/** Self-service withdrawal ends when registration closes; after that it's an
 *  admin action, so the waitlist promotion happens under the same hand. */
export function canSelfWithdraw(
  tournament: { status: TournamentStatus; registrationClosesAt: Date },
  now: Date = new Date(),
): boolean {
  return tournament.status === "registration_open" && now < tournament.registrationClosesAt;
}
