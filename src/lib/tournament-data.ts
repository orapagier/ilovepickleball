import { DateTime } from "luxon";
import { prisma } from "@/lib/prisma";
import { sweepTournaments } from "@/lib/tournament-engine";
import type { TournamentFormat, TournamentStatus } from "@/generated/prisma/enums";

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

export async function listPublicTournaments(filters?: {
  status?: TournamentStatus;
  format?: TournamentFormat;
  skillLevel?: string;
}) {
  await sweepTournaments();
  return prisma.tournament.findMany({
    where: {
      status: filters?.status ? filters.status : { in: PUBLIC_STATUSES },
      ...(filters?.format ? { format: filters.format } : {}),
      ...(filters?.skillLevel ? { skillLevel: filters.skillLevel } : {}),
    },
    include: {
      courts: { include: { court: { select: { id: true, name: true } } } },
      _count: { select: { registrations: true } },
    },
    orderBy: [{ startAt: "asc" }],
  });
}

/** Every skill band actually in use, for the browse filter — no separate
 *  taxonomy to keep in step with what admins type. */
export async function listSkillLevels(): Promise<string[]> {
  const rows = await prisma.tournament.groupBy({
    by: ["skillLevel"],
    where: { status: { in: PUBLIC_STATUSES }, skillLevel: { not: "" } },
  });
  return rows.map((r) => r.skillLevel).sort();
}

export async function listAdminTournaments() {
  await sweepTournaments();
  return prisma.tournament.findMany({
    include: {
      courts: { include: { court: { select: { id: true, name: true } } } },
      _count: { select: { registrations: true, matches: true } },
    },
    orderBy: [{ startAt: "desc" }],
  });
}

export async function getTournamentDetail(id: string) {
  await sweepTournaments();
  return prisma.tournament.findUnique({
    where: { id },
    include: {
      courts: { include: { court: { select: { id: true, name: true } } }, orderBy: { courtId: "asc" } },
      sessions: { orderBy: { startAt: "asc" }, include: { _count: { select: { matches: true } } } },
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
  });
}

export type TournamentDetail = NonNullable<Awaited<ReturnType<typeof getTournamentDetail>>>;
export type TournamentMatch = TournamentDetail["matches"][number];
export type TournamentEntry = TournamentDetail["registrations"][number];

/** The tournaments a member is in, newest play date first — what "my
 *  tournaments" needs, including the live "you're up" state. */
export async function getMyTournaments(userId: string) {
  await sweepTournaments();
  return prisma.registration.findMany({
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
  });
}
