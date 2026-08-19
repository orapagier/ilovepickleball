import { DateTime } from "luxon";
import { prisma, withDbRetry } from "@/lib/prisma";
import { sweepTournaments } from "@/lib/tournament-engine";
import { championOf, finalPlacements, resolveFormatConfig } from "@/lib/tournament";
import type { RegistrationStatus, TournamentFormat, TournamentStatus } from "@/generated/prisma/enums";

/**
 * Reads for the tournament pages. Every entry point sweeps first, for the same
 * reason `getBusyIntervals*` reaps expired holds: there is no cron here, so a
 * registration deadline or a start time only takes effect the next time
 * somebody looks at the tournaments.
 */

/** Statuses a member can see. A draft is the admin's working copy. */
export const PUBLIC_STATUSES: TournamentStatus[] = [
  "registration_open",
  "registration_closed",
  "in_progress",
  "completed",
  "cancelled",
];

/** An instant as the "YYYY-MM-DDTHH:mm" a `datetime-local` input wants, read in
 *  the business timezone — the same zone `saveTournament` parses it back in. */
export function toDateTimeLocalValue(date: Date | null, tz: string): string {
  if (!date) return "";
  return DateTime.fromJSDate(date, { zone: tz }).toFormat("yyyy-LL-dd'T'HH:mm");
}

/** How an entry is named everywhere it appears: one player, or a doubles pair. */
export function entryName(entry: {
  player1: { name: string };
  player2: { name: string } | null;
}): string {
  const first = entry.player1.name.trim() || "Unnamed member";
  if (!entry.player2) return first;
  return `${first} / ${entry.player2.name.trim() || "Unnamed member"}`;
}

const entryInclude = {
  player1: { select: { id: true, name: true, email: true } },
  player2: { select: { id: true, name: true, email: true } },
} as const;

/**
 * The entries a card means when it says "6 of 8".
 *
 * `maxEntries` is the cap `joinTournament` measures against, and it measures
 * against the *registered* count — anything past it is waitlisted rather than
 * refused. Counting every row instead made a full draw with a waitlist and a
 * withdrawal read "13 of 11", which is not a sentence about anything. The
 * tournament's own page has always used this rule; the list pages now use it too.
 */
const CAP_STATUSES: RegistrationStatus[] = ["registered", "checked_in"];
const ENTRIES_AGAINST_THE_CAP = { where: { status: { in: CAP_STATUSES } } };

export async function listPublicTournaments(filters?: {
  status?: TournamentStatus;
  format?: TournamentFormat;
  /** Keep only tournaments a player at this rating may actually enter. An
   *  open-ended bound admits everyone on that side, and a tournament with no
   *  band at all admits everyone full stop — which is why both sides test for
   *  null as well as for the number. */
  openToRating?: number;
}) {
  await sweepTournaments();
  const rating = filters?.openToRating;
  return withDbRetry(() =>
    prisma.tournament.findMany({
      where: {
        status: filters?.status ? filters.status : { in: PUBLIC_STATUSES },
        ...(filters?.format ? { format: filters.format } : {}),
        ...(rating === undefined
          ? {}
          : {
              AND: [
                { OR: [{ minSkillRating: null }, { minSkillRating: { lte: rating } }] },
                { OR: [{ maxSkillRating: null }, { maxSkillRating: { gte: rating } }] },
              ],
            }),
      },
      include: {
        courts: { include: { court: { select: { id: true, name: true } } } },
        _count: { select: { registrations: ENTRIES_AGAINST_THE_CAP } },
      },
      orderBy: [{ startAt: "asc" }],
    }),
  );
}

export async function listAdminTournaments() {
  await sweepTournaments();
  return withDbRetry(() =>
    prisma.tournament.findMany({
      include: {
        courts: { include: { court: { select: { id: true, name: true } } } },
        _count: { select: { registrations: ENTRIES_AGAINST_THE_CAP, matches: true } },
      },
      orderBy: [{ startAt: "desc" }],
    }),
  );
}

export async function getTournamentDetail(id: string) {
  await sweepTournaments();
  return withDbRetry(() =>
    prisma.tournament.findUnique({
      where: { id },
      include: {
        courts: { include: { court: { select: { id: true, name: true } } }, orderBy: { courtId: "asc" } },
        sessions: { orderBy: { startAt: "asc" }, include: { _count: { select: { matches: true } } } },
        // Ordered by place so the prize list reads down the podium without the
        // page having to sort it again.
        prizes: { orderBy: { place: "asc" } },
        registrations: {
          include: entryInclude,
          orderBy: [{ seed: "asc" }, { registeredAt: "asc" }],
        },
        matches: {
          include: {
            sideA: { include: entryInclude },
            sideB: { include: entryInclude },
            court: { select: { id: true, name: true } },
            session: { select: { id: true, name: true, startAt: true, endAt: true } },
          },
          orderBy: [{ round: "asc" }, { matchNumber: "asc" }],
        },
      },
    }),
  );
}

export type TournamentDetail = NonNullable<Awaited<ReturnType<typeof getTournamentDetail>>>;
export type TournamentMatch = TournamentDetail["matches"][number];
export type TournamentEntry = TournamentDetail["registrations"][number];

/* ------------------------------------------------------------------ *
 * Results for a list of tournaments
 * ------------------------------------------------------------------ */

/** What a results card needs off one entry: who it is, whether it is in the
 *  draw, and which pool it was drawn into. */
const resultEntrySelect = {
  id: true,
  tournamentId: true,
  status: true,
  seed: true,
  pool: true,
  player1: { select: { name: true } },
  player2: { select: { name: true } },
} as const;

/** What a results card needs off one match. A superset of what `buildStandings`
 *  and `finalPlacements` read, plus the court, because "who is on court right
 *  now" is the one thing a live card exists to say. */
const resultMatchSelect = {
  id: true,
  tournamentId: true,
  round: true,
  matchNumber: true,
  status: true,
  bracket: true,
  pool: true,
  score: true,
  courtId: true,
  sideARegistrationId: true,
  sideBRegistrationId: true,
  winnerRegistrationId: true,
  court: { select: { name: true } },
} as const;

/**
 * Entries, matches and prizes for a whole page of tournaments at once.
 *
 * Three queries for any number of tournaments, not three per tournament: the
 * browse page shows a standings card on every live tournament and a winners
 * card on every finished one, and doing that by including the relations on
 * `listPublicTournaments` would drag the full match list of every tournament
 * ever run through a page that mostly wants names and dates. Ask for the
 * results of the ones that actually have results, and group them here.
 */
export async function listTournamentResults(tournamentIds: readonly string[]) {
  const ids = [...new Set(tournamentIds)];
  const grouped = new Map<
    string,
    {
      registrations: Awaited<ReturnType<typeof loadResultEntries>>;
      matches: Awaited<ReturnType<typeof loadResultMatches>>;
      prizes: { place: number; label: string; amountCents: number | null; description: string }[];
    }
  >();
  if (ids.length === 0) return grouped;

  /* Retried as a set rather than one query at a time: they are three reads of
     the same instant, and re-running all three on a fresh connection keeps them
     that way. */
  const [registrations, matches, prizes] = await withDbRetry(() =>
    Promise.all([
      loadResultEntries(ids),
      loadResultMatches(ids),
      prisma.tournamentPrize.findMany({
        where: { tournamentId: { in: ids } },
        orderBy: { place: "asc" },
        select: { tournamentId: true, place: true, label: true, amountCents: true, description: true },
      }),
    ]),
  );

  for (const id of ids) grouped.set(id, { registrations: [], matches: [], prizes: [] });
  for (const row of registrations) grouped.get(row.tournamentId)?.registrations.push(row);
  for (const row of matches) grouped.get(row.tournamentId)?.matches.push(row);
  for (const row of prizes) grouped.get(row.tournamentId)?.prizes.push(row);
  return grouped;
}

function loadResultEntries(ids: string[]) {
  return prisma.registration.findMany({
    where: { tournamentId: { in: ids } },
    select: resultEntrySelect,
    orderBy: [{ seed: "asc" }, { registeredAt: "asc" }],
  });
}

function loadResultMatches(ids: string[]) {
  return prisma.match.findMany({
    where: { tournamentId: { in: ids } },
    select: resultMatchSelect,
    orderBy: [{ round: "asc" }, { matchNumber: "asc" }],
  });
}

export type TournamentResults = NonNullable<
  ReturnType<Awaited<ReturnType<typeof listTournamentResults>>["get"]>
>;
export type ResultEntry = TournamentResults["registrations"][number];
export type ResultMatch = TournamentResults["matches"][number];

/* ------------------------------------------------------------------ *
 * The homepage promo
 * ------------------------------------------------------------------ */

/**
 * The two things the homepage advertises: what is being played right now, and
 * what can still be entered.
 *
 * Deliberately does **not** sweep. The sweep exists to make a passed deadline
 * take effect, and it draws brackets and starts play — real work to hang off a
 * page that is mostly a photo and an address. The two `where` clauses below ask
 * the same questions `isJoinable` does, so a tournament whose deadline has gone
 * is filtered out here whether or not anything has got round to closing it. A
 * promo tile that is thirty seconds behind the tournaments page is fine; a
 * homepage that runs a draw is not.
 */
export async function getTournamentPromo(now: Date = new Date()) {
  const tournaments = await withDbRetry(() =>
    prisma.tournament.findMany({
      where: {
        OR: [
          { status: "in_progress" },
          {
            status: "registration_open",
            registrationClosesAt: { gt: now },
            // Published but not yet open reads as "enter now" and isn't.
            OR: [{ registrationOpensAt: null }, { registrationOpensAt: { lte: now } }],
          },
        ],
      },
      select: {
        id: true,
        name: true,
        status: true,
        format: true,
        playType: true,
        minSkillRating: true,
        maxSkillRating: true,
        maxEntries: true,
        entryFeeCents: true,
        currency: true,
        startAt: true,
        registrationClosesAt: true,
        poolCount: true,
        advancePerPool: true,
        swissRounds: true,
      },
      orderBy: [{ startAt: "asc" }],
    }),
  );
  if (tournaments.length === 0) return { live: [], open: [] };

  const ids = tournaments.map((t) => t.id);

  /* Two aggregates rather than a count per tournament. `groupBy` returns one
     small row per (tournament, bucket), so the cost is flat in the number of
     tournaments however many matches they hold between them. */
  const [entryCounts, matchCounts] = await withDbRetry(() =>
    Promise.all([
      prisma.registration.groupBy({
        by: ["tournamentId", "status"],
        where: { tournamentId: { in: ids } },
        _count: { _all: true },
      }),
      prisma.match.groupBy({
        by: ["tournamentId", "round", "status"],
        where: { tournamentId: { in: ids } },
        _count: { _all: true },
      }),
    ]),
  );

  const registered = new Map<string, number>();
  for (const row of entryCounts) {
    if (row.status !== "registered" && row.status !== "checked_in") continue;
    registered.set(row.tournamentId, (registered.get(row.tournamentId) ?? 0) + row._count._all);
  }

  const progress = new Map<string, { decided: number; drawn: number; currentRound: number }>();
  for (const row of matchCounts) {
    const at = progress.get(row.tournamentId) ?? { decided: 0, drawn: 0, currentRound: Number.POSITIVE_INFINITY };
    const settled = row.status === "completed" || row.status === "walkover";
    at.drawn += row._count._all;
    if (settled) at.decided += row._count._all;
    // The round being played is the earliest one still holding something unplayed.
    else at.currentRound = Math.min(at.currentRound, row.round);
    progress.set(row.tournamentId, at);
  }

  const decorate = (t: (typeof tournaments)[number]) => {
    const at = progress.get(t.id);
    return {
      ...t,
      entries: registered.get(t.id) ?? 0,
      decided: at?.decided ?? 0,
      drawn: at?.drawn ?? 0,
      currentRound: at && Number.isFinite(at.currentRound) ? at.currentRound : null,
    };
  };

  return {
    live: tournaments.filter((t) => t.status === "in_progress").map(decorate),
    open: tournaments.filter((t) => t.status === "registration_open").map(decorate),
  };
}

export type TournamentPromo = Awaited<ReturnType<typeof getTournamentPromo>>;
export type PromoTournament = TournamentPromo["live"][number];

/** The tournaments a member is in, newest play date first — what "my
 *  tournaments" needs, including the live "you're up" state. */
export async function getMyTournaments(userId: string) {
  await sweepTournaments();
  return withDbRetry(() =>
    prisma.registration.findMany({
      where: {
        status: { not: "withdrawn" },
        OR: [{ player1Id: userId }, { player2Id: userId }],
      },
      include: {
        tournament: {
          include: { courts: { include: { court: { select: { id: true, name: true } } } } },
        },
        matchesAsSideA: { include: { court: { select: { name: true } } } },
        matchesAsSideB: { include: { court: { select: { name: true } } } },
      },
      orderBy: { tournament: { startAt: "asc" } },
    }),
  );
}

/**
 * Who won the last tournament to finish, for the homepage.
 *
 * The champion is derived from the draw by `finalPlacements`, exactly as the
 * tournament's own results card derives it — nothing stores a winner, so a
 * second source of that fact would be a second thing to keep true.
 *
 * Null when there is nothing honest to show: no finished tournament, or one
 * whose top line is still shared (a round robin that ended level, say). A tied
 * champion is not a champion to put a face on.
 */
export async function getLatestChampion() {
  const t = await withDbRetry(() =>
    prisma.tournament.findFirst({
      where: { status: "completed" },
      // `completedAt` is when the last match was played; `startAt` only breaks
      // a tie between two finished on the same sweep.
      orderBy: [{ completedAt: "desc" }, { startAt: "desc" }],
      select: {
        id: true,
        name: true,
        format: true,
        playType: true,
        minSkillRating: true,
        maxSkillRating: true,
        poolCount: true,
        advancePerPool: true,
        swissRounds: true,
        completedAt: true,
        registrations: {
          select: {
            id: true,
            status: true,
            pool: true,
            player1: { select: { name: true, image: true } },
            player2: { select: { name: true, image: true } },
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
      },
    }),
  );
  if (!t) return null;

  const inDraw = t.registrations.filter((r) => r.status !== "withdrawn" && r.status !== "waitlisted");
  const config = resolveFormatConfig(t.format, inDraw.length, t);
  const winnerId = championOf(finalPlacements(t.format, config, inDraw, t.matches));
  const entry = winnerId ? inDraw.find((r) => r.id === winnerId) : null;
  if (!entry) return null;

  return {
    id: t.id,
    name: t.name,
    format: t.format,
    playType: t.playType,
    minSkillRating: t.minSkillRating,
    maxSkillRating: t.maxSkillRating,
    completedAt: t.completedAt,
    /* One player in singles, two in doubles — both win it, so both are named
       and both get their picture on it. */
    players: [entry.player1, entry.player2].filter((p) => p !== null),
  };
}

export type LatestChampion = NonNullable<Awaited<ReturnType<typeof getLatestChampion>>>;
