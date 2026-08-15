"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DateTime } from "luxon";
import { prisma } from "@/lib/prisma";
import { getSessionUser, getProfileCompletion, type SessionUser } from "@/lib/auth-helpers";
import { getSettings } from "@/lib/booking-data";
import {
  assignFreeCourts,
  cancelTournamentRecord,
  closeRegistrationAndDraw,
  completeIfFinished,
  promoteFromWaitlist,
  refundEntryFee,
  refreshMatchStates,
  settleAfterMatch,
  syncCourtBlocks,
} from "@/lib/tournament-engine";
import {
  canSelfWithdraw,
  isCancellable,
  isFieldEditable,
  isJoinable,
  MAX_ROUND_ROBIN_ENTRIES,
  maxSwissRounds,
  MIN_TOURNAMENT_ENTRIES,
  tournamentDeletability,
  type EditableField,
} from "@/lib/tournament";
import {
  canEnterAtRating,
  formatSkillBand,
  formatSkillRating,
  hasSkillBand,
  parseSkillRating,
  skillBandError,
} from "@/lib/skill";
import type { TournamentFormat, TournamentPlayType } from "@/generated/prisma/enums";

export type ActionState = { error?: string; ok?: boolean; message?: string };

async function requireAdminOrThrow(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/signin");
  if (user.role !== "admin") throw new Error("Forbidden: admin access required.");
  return user;
}

function revalidateTournamentViews(tournamentId?: string) {
  revalidatePath("/tournaments");
  revalidatePath("/tournaments/[id]", "page");
  revalidatePath("/admin/tournaments");
  revalidatePath("/admin/tournaments/[id]", "page");
  revalidatePath("/admin/tournaments/[id]/run", "page");
  // Court blocks move with the tournament, so the booking views change too.
  revalidatePath("/book");
  revalidatePath("/admin/bookings");
  if (tournamentId) revalidatePath(`/tournaments/${tournamentId}`);
}

/* ------------------------------------------------------------------ *
 * Create / edit
 * ------------------------------------------------------------------ */

const FORMATS: TournamentFormat[] = [
  "single_elimination",
  "round_robin",
  "double_elimination",
  "pool_to_bracket",
  "swiss",
];
const PLAY_TYPES: TournamentPlayType[] = ["singles", "doubles"];

/** `datetime-local` inputs carry no zone, and every other time in this app is
 *  business-local, so that's how they're read. Returns null for an empty field
 *  and undefined for one that couldn't be parsed at all. */
function parseLocalDateTime(raw: FormDataEntryValue | null, tz: string): Date | null | undefined {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const dt = DateTime.fromISO(value, { zone: tz });
  return dt.isValid ? dt.toJSDate() : undefined;
}

function parseIntField(raw: FormDataEntryValue | null): number | undefined {
  const n = Number(String(raw ?? "").trim());
  return Number.isInteger(n) ? n : undefined;
}

type TournamentInput = {
  name: string;
  description: string;
  format: TournamentFormat;
  playType: TournamentPlayType;
  minSkillRating: number | null;
  maxSkillRating: number | null;
  /** Windows of play supplied at creation. Always empty on an edit — an
   *  existing tournament's schedule is edited through `saveSession`, which can
   *  weigh the matches already sitting in a window. */
  sessions: { name: string; startAt: Date; endAt: Date }[];
  maxEntries: number;
  minEntries: number;
  entryFeeCents: number;
  registrationOpensAt: Date | null;
  registrationClosesAt: Date;
  startAt: Date;
  courtIds: number[];
  prizeDescription: string;
  averageMatchMinutes: number | null;
  courtChangeoverMinutes: number | null;
  poolCount: number | null;
  advancePerPool: number | null;
  swissRounds: number | null;
};

/** A format-shape field: blank means "let the format decide for this field
 *  size", which is not the same as any particular number. */
function parseOptionalCount(raw: FormDataEntryValue | null, max: number): number | null | undefined {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > max) return undefined;
  return n;
}

/** A pacing override: blank means "use the facility default", which is not the
 *  same as zero, so an empty field has to come back as null rather than 0. */
function parseOptionalMinutes(raw: FormDataEntryValue | null): number | null | undefined {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 600) return undefined;
  return n;
}

function readTournamentForm(formData: FormData, tz: string): TournamentInput | string {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return "Give the tournament a name.";

  const format = String(formData.get("format") ?? "") as TournamentFormat;
  if (!FORMATS.includes(format)) return "Choose a format.";
  const playType = String(formData.get("playType") ?? "") as TournamentPlayType;
  if (!PLAY_TYPES.includes(playType)) return "Choose singles or doubles.";

  /* The skill band is the entry rule itself, not a label describing one, so a
     bad pair of bounds is rejected here rather than quietly enforcing nothing. */
  const minSkillRating = parseSkillRating(formData.get("minSkillRating"));
  const maxSkillRating = parseSkillRating(formData.get("maxSkillRating"));
  if (minSkillRating === undefined || maxSkillRating === undefined) {
    return "Pick skill ratings from the list, or leave them blank for all levels.";
  }
  const bandError = skillBandError(minSkillRating, maxSkillRating);
  if (bandError) return bandError;

  /* Windows set on the create form. Same rules `saveSession` applies one at a
     time — named, ending after they start, and not overlapping — checked here
     against each other, since none of them exist yet to be checked against. */
  const sessionNames = formData.getAll("sessionName");
  const sessionStarts = formData.getAll("sessionStartAt");
  const sessionEnds = formData.getAll("sessionEndAt");
  const sessions: { name: string; startAt: Date; endAt: Date }[] = [];
  for (let i = 0; i < sessionNames.length; i++) {
    const name = String(sessionNames[i] ?? "").trim().slice(0, 60);
    if (!name) return "Name every window — “Round 1”, “Sunday AM”, whatever you call it.";
    const startAt = parseLocalDateTime(sessionStarts[i] ?? null, tz);
    const endAt = parseLocalDateTime(sessionEnds[i] ?? null, tz);
    if (!startAt || !endAt) return `Set when “${name}” starts and ends.`;
    if (endAt <= startAt) return `“${name}” has to end after it starts.`;
    const clash = sessions.find((s) => s.startAt < endAt && s.endAt > startAt);
    if (clash) return `“${name}” overlaps “${clash.name}”. Windows can't share time on the same courts.`;
    sessions.push({ name, startAt, endAt });
  }

  const maxEntries = parseIntField(formData.get("maxEntries"));
  const minEntries = parseIntField(formData.get("minEntries"));
  if (maxEntries == null || minEntries == null) return "Entry limits must be whole numbers.";
  if (minEntries < MIN_TOURNAMENT_ENTRIES) return `A tournament needs at least ${MIN_TOURNAMENT_ENTRIES} entries.`;
  if (minEntries > maxEntries) return "The minimum number of entries can't exceed the maximum.";
  if (format === "round_robin" && maxEntries > MAX_ROUND_ROBIN_ENTRIES) {
    return `A round robin is capped at ${MAX_ROUND_ROBIN_ENTRIES} entries — ${MAX_ROUND_ROBIN_ENTRIES} entries is already ${
      (MAX_ROUND_ROBIN_ENTRIES * (MAX_ROUND_ROBIN_ENTRIES - 1)) / 2
    } matches through two courts.`;
  }

  /* The format-shape fields. Each is read by one format and left null by the
     rest, and each is checked against the *maximum* field size rather than the
     eventual one — this runs long before anybody has entered. */
  const poolCount = parseOptionalCount(formData.get("poolCount"), Math.floor(maxEntries / MIN_TOURNAMENT_ENTRIES) || 1);
  if (poolCount === undefined) {
    return `The pool count has to be a whole number, and every pool needs ${MIN_TOURNAMENT_ENTRIES} entries.`;
  }
  const advancePerPool = parseOptionalCount(formData.get("advancePerPool"), maxEntries);
  if (advancePerPool === undefined) return "How many advance from each pool has to be a whole number.";
  const swissRounds = parseOptionalCount(formData.get("swissRounds"), maxSwissRounds(maxEntries));
  if (swissRounds === undefined) {
    return `A Swiss draw can run between 1 and ${maxSwissRounds(maxEntries)} rounds for this field — past that it would have to repeat a pairing.`;
  }
  if (format === "pool_to_bracket" && poolCount != null && advancePerPool != null) {
    const smallestPool = Math.floor(maxEntries / poolCount);
    if (advancePerPool > smallestPool) {
      return `Only ${smallestPool} entries would be in each pool, so ${advancePerPool} can't come out of one.`;
    }
    if (poolCount * advancePerPool < MIN_TOURNAMENT_ENTRIES) {
      return "The knockout needs at least two qualifiers.";
    }
  }

  // The form takes the fee in whole currency units, the way an admin thinks
  // about it; cents are the storage detail.
  const entryFee = Number(String(formData.get("entryFee") ?? "0").trim() || "0");
  if (!Number.isFinite(entryFee) || entryFee < 0) return "The entry fee must be zero or more.";
  const entryFeeCents = Math.round(entryFee * 100);

  const registrationOpensAt = parseLocalDateTime(formData.get("registrationOpensAt"), tz);
  if (registrationOpensAt === undefined) return "That registration opening time couldn't be read.";
  const registrationClosesAt = parseLocalDateTime(formData.get("registrationClosesAt"), tz);
  if (!registrationClosesAt) return "Set when registration closes.";
  const startAt = parseLocalDateTime(formData.get("startAt"), tz);
  if (!startAt) return "Set when play starts.";

  if (registrationClosesAt >= startAt) return "Registration has to close before play starts.";
  if (registrationOpensAt && registrationOpensAt >= registrationClosesAt) {
    return "Registration has to open before it closes.";
  }

  const courtIds = formData
    .getAll("courtIds")
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n));
  if (courtIds.length === 0) return "Pick at least one court for the tournament to use.";

  const averageMatchMinutes = parseOptionalMinutes(formData.get("averageMatchMinutes"));
  const courtChangeoverMinutes = parseOptionalMinutes(formData.get("courtChangeoverMinutes"));
  if (averageMatchMinutes === undefined || courtChangeoverMinutes === undefined) {
    return "Match length and changeover must be whole minutes, or blank to use the facility default.";
  }
  if (averageMatchMinutes !== null && averageMatchMinutes < 1) {
    return "A match has to be at least a minute long.";
  }

  return {
    name: name.slice(0, 120),
    description: String(formData.get("description") ?? "").slice(0, 2000),
    format,
    playType,
    minSkillRating,
    maxSkillRating,
    sessions,
    maxEntries,
    minEntries,
    entryFeeCents,
    registrationOpensAt,
    registrationClosesAt,
    startAt,
    courtIds,
    prizeDescription: String(formData.get("prizeDescription") ?? "").slice(0, 1000),
    averageMatchMinutes,
    courtChangeoverMinutes,
    poolCount,
    advancePerPool,
    swissRounds,
  };
}

/**
 * Create a draft, or edit an existing tournament. Edits are checked field by
 * field against what the current status still allows (§4 of the plan) — the
 * form hides what's locked, but this is what actually enforces it, since a
 * server action is reachable by a direct POST.
 */
export async function saveTournament(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdminOrThrow();
  const settings = await getSettings();
  const parsed = readTournamentForm(formData, settings.timezone);
  if (typeof parsed === "string") return { error: parsed };

  const id = String(formData.get("id") ?? "").trim();

  if (!id) {
    const created = await prisma.tournament.create({
      data: {
        name: parsed.name,
        description: parsed.description,
        format: parsed.format,
        playType: parsed.playType,
        minSkillRating: parsed.minSkillRating,
        maxSkillRating: parsed.maxSkillRating,
        maxEntries: parsed.maxEntries,
        minEntries: parsed.minEntries,
        entryFeeCents: parsed.entryFeeCents,
        currency: settings.currency,
        registrationOpensAt: parsed.registrationOpensAt,
        registrationClosesAt: parsed.registrationClosesAt,
        startAt: parsed.startAt,
        prizeDescription: parsed.prizeDescription,
        averageMatchMinutes: parsed.averageMatchMinutes,
        courtChangeoverMinutes: parsed.courtChangeoverMinutes,
        poolCount: parsed.poolCount,
        advancePerPool: parsed.advancePerPool,
        swissRounds: parsed.swissRounds,
        createdById: admin.id,
        courts: { create: parsed.courtIds.map((courtId) => ({ courtId })) },
        /* No `syncCourtBlocks` here: a draft blocks no courts, exactly as when
           a window is added to a draft through `saveSession`. Publishing is
           what puts the blocks on the calendar. */
        sessions: {
          create: parsed.sessions.map((s, i) => ({
            name: s.name,
            startAt: s.startAt,
            endAt: s.endAt,
            sortOrder: i + 1,
          })),
        },
      },
    });
    revalidateTournamentViews();
    redirect(`/admin/tournaments/${created.id}`);
  }

  const existing = await prisma.tournament.findUnique({
    where: { id },
    include: { courts: true, _count: { select: { registrations: true } } },
  });
  if (!existing) return { error: "Tournament not found." };

  const currentCourtIds = existing.courts.map((c) => c.courtId).sort((a, b) => a - b);
  const nextCourtIds = [...parsed.courtIds].sort((a, b) => a - b);

  /* Only what actually changed is checked, so re-submitting a form whose
     locked fields still hold their current values isn't an error — the admin
     changed nothing there. */
  const changed: EditableField[] = [];
  const same = (field: EditableField, unchanged: boolean) => {
    if (!unchanged) changed.push(field);
  };
  same("name", existing.name === parsed.name);
  same("description", existing.description === parsed.description);
  same("format", existing.format === parsed.format);
  same("playType", existing.playType === parsed.playType);
  same(
    "skillBand",
    existing.minSkillRating === parsed.minSkillRating && existing.maxSkillRating === parsed.maxSkillRating,
  );
  same("maxEntries", existing.maxEntries === parsed.maxEntries);
  same("minEntries", existing.minEntries === parsed.minEntries);
  same("entryFeeCents", existing.entryFeeCents === parsed.entryFeeCents);
  same(
    "registrationOpensAt",
    (existing.registrationOpensAt?.getTime() ?? null) === (parsed.registrationOpensAt?.getTime() ?? null),
  );
  same("registrationClosesAt", existing.registrationClosesAt.getTime() === parsed.registrationClosesAt.getTime());
  same("startAt", existing.startAt.getTime() === parsed.startAt.getTime());
  same("courtIds", currentCourtIds.join(",") === nextCourtIds.join(","));
  same("prizeDescription", existing.prizeDescription === parsed.prizeDescription);
  same(
    "pacing",
    existing.averageMatchMinutes === parsed.averageMatchMinutes &&
      existing.courtChangeoverMinutes === parsed.courtChangeoverMinutes,
  );
  /* The pool and Swiss knobs move with the format: they decide the shape of the
     draw, so they lock the moment entries open, exactly as `format` does. */
  same(
    "formatShape",
    existing.poolCount === parsed.poolCount &&
      existing.advancePerPool === parsed.advancePerPool &&
      existing.swissRounds === parsed.swissRounds,
  );

  const locked = changed.filter((field) => !isFieldEditable(existing.status, field));
  if (locked.length > 0) {
    return { error: `Can't change ${locked.join(", ")} once a tournament is ${existing.status.replace(/_/g, " ")}.` };
  }

  // Three rules the field list alone can't express, all of them about not
  // moving the goalposts under people who have already entered.
  if (existing.status === "registration_open") {
    if (parsed.registrationClosesAt < existing.registrationClosesAt) {
      return { error: "Registration can be extended, but not closed earlier by editing — use “Close registration now”." };
    }
    /* Entries can be opened sooner (or straight away, by clearing the date),
       never later: a member who can already see a date they're waiting on
       shouldn't have it moved out from under them. An empty field means "open
       now", which is the earliest value there is. */
    const currentOpens = existing.registrationOpensAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    const nextOpens = parsed.registrationOpensAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    if (nextOpens > currentOpens) {
      return { error: "Entries can be opened earlier, or opened now by clearing the date — but not pushed back." };
    }
    const registered = await prisma.registration.count({ where: { tournamentId: id, status: "registered" } });
    if (parsed.maxEntries < registered) {
      return { error: `${registered} entries are already registered, so the cap can't drop below that.` };
    }
  }

  await prisma.tournament.update({
    where: { id },
    data: {
      name: parsed.name,
      description: parsed.description,
      format: parsed.format,
      playType: parsed.playType,
      minSkillRating: parsed.minSkillRating,
      maxSkillRating: parsed.maxSkillRating,
      maxEntries: parsed.maxEntries,
      minEntries: parsed.minEntries,
      entryFeeCents: parsed.entryFeeCents,
      registrationOpensAt: parsed.registrationOpensAt,
      registrationClosesAt: parsed.registrationClosesAt,
      startAt: parsed.startAt,
      prizeDescription: parsed.prizeDescription,
      averageMatchMinutes: parsed.averageMatchMinutes,
      courtChangeoverMinutes: parsed.courtChangeoverMinutes,
      poolCount: parsed.poolCount,
      advancePerPool: parsed.advancePerPool,
      swissRounds: parsed.swissRounds,
    },
  });

  if (changed.includes("courtIds")) {
    await prisma.tournamentCourt.deleteMany({ where: { tournamentId: id } });
    await prisma.tournamentCourt.createMany({
      data: parsed.courtIds.map((courtId) => ({ tournamentId: id, courtId })),
    });
  }

  // A raised cap can let waitlisted entries in; a moved start, a changed court
  // list, or new pacing all resize the blocks holding the courts.
  if (changed.includes("maxEntries")) await promoteFromWaitlist(id);
  if (
    existing.status !== "draft" &&
    (changed.includes("courtIds") ||
      changed.includes("startAt") ||
      changed.includes("pacing") ||
      changed.includes("formatShape"))
  ) {
    await syncCourtBlocks(id);
  }

  revalidateTournamentViews(id);
  return { ok: true, message: "Saved." };
}

/* ------------------------------------------------------------------ *
 * Status transitions
 * ------------------------------------------------------------------ */

export async function publishTournament(tournamentId: string): Promise<ActionState> {
  await requireAdminOrThrow();
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId }, include: { courts: true } });
  if (!tournament) return { error: "Tournament not found." };
  if (tournament.status !== "draft") return { error: "Only a draft can be published." };
  if (tournament.courts.length === 0) return { error: "Pick at least one court before publishing." };

  await prisma.tournament.update({ where: { id: tournamentId }, data: { status: "registration_open" } });
  // Courts are held from publish, not from the day itself — the point is that
  // members can't book over a tournament that has already opened for entries.
  await syncCourtBlocks(tournamentId);

  revalidateTournamentViews(tournamentId);
  return { ok: true, message: "Published — members can enter now." };
}

export async function closeRegistrationNow(tournamentId: string): Promise<ActionState> {
  await requireAdminOrThrow();
  const result = await closeRegistrationAndDraw(tournamentId);
  revalidateTournamentViews(tournamentId);

  if (result.outcome === "skipped") return { error: result.reason };
  if (result.outcome === "cancelled") return { ok: true, message: result.reason };
  return {
    ok: true,
    message: `Draw generated — ${result.entries} entries, ${result.matches} matches.`,
  };
}

export async function startPlay(tournamentId: string): Promise<ActionState> {
  await requireAdminOrThrow();
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { status: true } });
  if (!tournament) return { error: "Tournament not found." };
  if (tournament.status !== "registration_closed") {
    return { error: "Play can only start once registration is closed and the draw is made." };
  }

  await prisma.tournament.update({ where: { id: tournamentId }, data: { status: "in_progress" } });
  const assigned = await assignFreeCourts(tournamentId);

  revalidateTournamentViews(tournamentId);
  return { ok: true, message: `Play started — ${assigned} ${assigned === 1 ? "match" : "matches"} on court.` };
}

export async function cancelTournament(tournamentId: string): Promise<ActionState> {
  await requireAdminOrThrow();
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { status: true } });
  if (!tournament) return { error: "Tournament not found." };
  if (!isCancellable(tournament.status)) return { error: "This tournament is already finished or cancelled." };

  await cancelTournamentRecord(tournamentId, "Cancelled by an admin.");
  revalidateTournamentViews(tournamentId);
  return { ok: true, message: "Cancelled — every entry was withdrawn and the courts released." };
}

/**
 * Delete a tournament and everything under it — entries, matches, windows, and
 * the court blocks it held. Gated by `tournamentDeletability`: cancelled ones go
 * on request, finished ones after the retention window, live ones never.
 *
 * Irreversible, and there is no soft-delete to fall back on, so the UI points at
 * the export first.
 */
export async function deleteTournament(tournamentId: string): Promise<ActionState> {
  await requireAdminOrThrow();
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { id: true, name: true, status: true, completedAt: true, updatedAt: true },
  });
  if (!tournament) return { error: "Tournament not found." };

  const verdict = tournamentDeletability(tournament);
  if (!verdict.deletable) return { error: verdict.reason };

  /* Registrations, matches and sessions cascade from the tournament row, but
     the court blocks don't: `Booking.tournamentId` is ON DELETE SET NULL, so
     without this they'd survive as orphaned bookings owned by whichever admin
     published. They carry no payment and no customer intent — they're bookings
     only so the availability checks could see them — so they go too. */
  await prisma.booking.deleteMany({ where: { tournamentId } });
  await prisma.tournament.delete({ where: { id: tournamentId } });

  revalidateTournamentViews();
  /* Whoever did this was almost certainly standing on the tournament's own
     page, which is now a 404 of the thing they just deleted. Leaving is the
     only sensible next view, so the action decides it rather than each caller. */
  redirect("/admin/tournaments");
}

/* ------------------------------------------------------------------ *
 * Running the day
 * ------------------------------------------------------------------ */

export async function assignMatchCourt(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdminOrThrow();
  const matchId = String(formData.get("matchId") ?? "");
  const courtId = parseIntField(formData.get("courtId"));
  if (courtId == null) return { error: "Pick a court." };

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: { id: true, tournamentId: true, status: true, sideARegistrationId: true, sideBRegistrationId: true },
  });
  if (!match) return { error: "Match not found." };
  if (match.status !== "ready") return { error: "Only a queued match can be sent to a court." };
  if (!match.sideARegistrationId || !match.sideBRegistrationId) {
    return { error: "This match is still waiting on a side." };
  }

  const occupant = await prisma.match.findFirst({
    where: { tournamentId: match.tournamentId, courtId, status: "in_progress" },
    select: { id: true },
  });
  if (occupant) return { error: "That court already has a match on it." };

  await prisma.match.update({
    where: { id: matchId },
    data: { courtId, status: "in_progress", scheduledAt: new Date() },
  });

  revalidateTournamentViews(match.tournamentId);
  return { ok: true };
}

export async function completeMatch(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdminOrThrow();
  const matchId = String(formData.get("matchId") ?? "");
  const score = String(formData.get("score") ?? "").trim().slice(0, 100);
  const winnerRegistrationId = String(formData.get("winnerRegistrationId") ?? "");

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: {
      id: true,
      tournamentId: true,
      status: true,
      sideARegistrationId: true,
      sideBRegistrationId: true,
    },
  });
  if (!match) return { error: "Match not found." };
  if (match.status !== "in_progress" && match.status !== "ready") {
    return { error: "This match has already been recorded." };
  }
  if (winnerRegistrationId !== match.sideARegistrationId && winnerRegistrationId !== match.sideBRegistrationId) {
    return { error: "Pick which side won." };
  }
  if (!score) return { error: "Enter the score, e.g. 11-7, 11-9." };

  await prisma.match.update({
    where: { id: matchId },
    data: { status: "completed", score, winnerRegistrationId, completedAt: new Date() },
  });
  await settleAfterMatch(match.tournamentId, matchId);

  revalidateTournamentViews(match.tournamentId);
  return { ok: true };
}

export async function recordWalkover(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdminOrThrow();
  const matchId = String(formData.get("matchId") ?? "");
  const noShowSide = String(formData.get("noShowSide") ?? "");
  if (noShowSide !== "A" && noShowSide !== "B") return { error: "Pick which side didn't show." };

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: {
      id: true,
      tournamentId: true,
      status: true,
      sideARegistrationId: true,
      sideBRegistrationId: true,
    },
  });
  if (!match) return { error: "Match not found." };
  if (match.status === "completed" || match.status === "walkover") {
    return { error: "This match has already been recorded." };
  }

  const noShowId = noShowSide === "A" ? match.sideARegistrationId : match.sideBRegistrationId;
  const winnerRegistrationId = noShowSide === "A" ? match.sideBRegistrationId : match.sideARegistrationId;
  if (!winnerRegistrationId) return { error: "The other side isn't decided yet." };

  await prisma.match.update({
    where: { id: matchId },
    // The court is released rather than kept — a walkover never occupies one.
    data: { status: "walkover", winnerRegistrationId, completedAt: new Date(), courtId: null },
  });
  if (noShowId) {
    await prisma.registration.update({ where: { id: noShowId }, data: { status: "no_show" } });
  }
  await settleAfterMatch(match.tournamentId, matchId);

  revalidateTournamentViews(match.tournamentId);
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * Entries
 * ------------------------------------------------------------------ */

/**
 * Refuses an entry whose players don't sit inside the tournament's skill band,
 * naming who is out and why. Returns null when everyone may play.
 *
 * The message distinguishes "you have no rating" from "your rating is wrong for
 * this one", because the first is fixable by the member in about ten seconds and
 * the second isn't fixable at all.
 */
async function checkSkillBand(
  tournament: { minSkillRating: number | null; maxSkillRating: number | null },
  userId: string,
  partnerId: string | null,
): Promise<string | null> {
  const { minSkillRating: min, maxSkillRating: max } = tournament;
  if (!hasSkillBand(min, max)) return null;

  const band = formatSkillBand(min, max);
  const players = await prisma.user.findMany({
    where: { id: { in: [userId, ...(partnerId ? [partnerId] : [])] } },
    select: { id: true, name: true, skillRating: true },
  });

  for (const player of players) {
    const verdict = canEnterAtRating(player.skillRating, min, max);
    if (verdict.ok) continue;

    const isSelf = player.id === userId;
    const who = isSelf ? "You" : player.name.trim() || "Your partner";
    if (verdict.reason === "unrated") {
      return isSelf
        ? `This tournament is for ${band} players. Set your skill level on your profile first, then enter.`
        : `${who} has no skill level set yet — this tournament is for ${band} players. Ask them to set it on their profile first.`;
    }
    return `This tournament is for ${band} players and ${isSelf ? "you are" : `${who} is`} rated ${formatSkillRating(player.skillRating)}.`;
  }
  return null;
}

export async function joinTournament(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await getSessionUser();
  const tournamentId = String(formData.get("tournamentId") ?? "");
  if (!user) redirect(`/signin?callbackUrl=/tournaments/${tournamentId}`);

  const { complete } = await getProfileCompletion(user.id);
  if (!complete) redirect(`/register?callbackUrl=/tournaments/${tournamentId}`);

  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId } });
  if (!tournament) return { error: "Tournament not found." };
  if (!isJoinable(tournament)) return { error: "This tournament isn't taking entries right now." };

  /* Partners are added straight away, with no invite/accept handshake in v1 —
     so the partner is looked up by the email they signed in with rather than
     picked from a list, which would show every member to every member. */
  let partnerId: string | null = null;
  if (tournament.playType === "doubles") {
    const partnerEmail = String(formData.get("partnerEmail") ?? "").trim().toLowerCase();
    if (!partnerEmail) return { error: "Doubles needs a partner — enter the email they sign in with." };
    if (partnerEmail === (user.email ?? "").toLowerCase()) return { error: "You can't partner with yourself." };

    const partner = await prisma.user.findUnique({ where: { email: partnerEmail }, select: { id: true } });
    if (!partner) return { error: "No member is signed up with that email — ask them to sign in once first." };
    partnerId = partner.id;
  }

  /* The skill band is checked on everyone who would be in the draw, not just
     whoever filled the form — a doubles pair enters as one entry, so an
     out-of-band partner is an out-of-band entry. */
  const bandError = await checkSkillBand(tournament, user.id, partnerId);
  if (bandError) return { error: bandError };

  /* Deliberately after the band check, so nobody is ever asked for a payment
     reference for a tournament they cannot enter. The fee is settled by hand
     before anything here confirms it, so "you don't qualify" arriving second
     would mean it arrived after the money.

     A reference is required whenever there's a fee, so staff always have a
     thread to pull on. It is free text on purpose: the desk takes cash and
     bank transfers as well as e-wallets, so a mobile number is a perfectly
     good answer. Nothing here verifies payment — `feePaid` is still ticked by
     hand once the money is actually seen. */
  const hasFee = tournament.entryFeeCents > 0;
  const paymentReference = String(formData.get("paymentReference") ?? "").trim().slice(0, 60);
  if (hasFee && !paymentReference) {
    return { error: "Enter your payment reference — your GCash, BDO, or QRPh reference, or your mobile number if you're arranging it with the desk." };
  }

  const playerIds = [user.id, ...(partnerId ? [partnerId] : [])];
  const clash = await prisma.registration.findFirst({
    where: {
      tournamentId,
      status: { not: "withdrawn" },
      OR: [{ player1Id: { in: playerIds } }, { player2Id: { in: playerIds } }],
    },
    select: { player1Id: true },
  });
  if (clash) {
    return {
      error:
        clash.player1Id === user.id || playerIds.length === 1
          ? "You're already entered in this tournament."
          : "One of you is already entered in this tournament.",
    };
  }

  // Past the cap the entry is waitlisted rather than refused, so a withdrawal
  // can promote it later without the member having to watch for a free spot.
  const registered = await prisma.registration.count({ where: { tournamentId, status: "registered" } });
  const status = registered >= tournament.maxEntries ? "waitlisted" : "registered";

  await prisma.registration.create({
    data: { tournamentId, player1Id: user.id, player2Id: partnerId, status, paymentReference },
  });

  revalidateTournamentViews(tournamentId);
  return {
    ok: true,
    message:
      status === "registered"
        ? "You're in. We'll post the draw when registration closes."
        : "The draw is full, so you're on the waitlist — you'll move up if an entry withdraws.",
  };
}

export async function withdrawFromTournament(tournamentId: string): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user) redirect("/signin");

  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId } });
  if (!tournament) return { error: "Tournament not found." };
  if (!canSelfWithdraw(tournament)) {
    return { error: "Registration has closed — ask an admin to withdraw your entry." };
  }

  const entry = await prisma.registration.findFirst({
    where: {
      tournamentId,
      status: { not: "withdrawn" },
      OR: [{ player1Id: user.id }, { player2Id: user.id }],
    },
    select: { id: true, tournamentId: true, feePaid: true },
  });
  if (!entry) return { error: "You aren't entered in this tournament." };

  refundEntryFee(entry);
  await prisma.registration.update({ where: { id: entry.id }, data: { status: "withdrawn" } });
  await promoteFromWaitlist(tournamentId);

  revalidateTournamentViews(tournamentId);
  return { ok: true, message: "Withdrawn." };
}

/** After registration closes only an admin can pull an entry — and doing so
 *  promotes the next waitlisted one, and reopens whatever the draw needs. */
export async function adminWithdrawEntry(registrationId: string): Promise<ActionState> {
  await requireAdminOrThrow();
  const entry = await prisma.registration.findUnique({
    where: { id: registrationId },
    select: { id: true, tournamentId: true, feePaid: true, status: true },
  });
  if (!entry) return { error: "Entry not found." };
  if (entry.status === "withdrawn") return { error: "That entry is already withdrawn." };

  refundEntryFee(entry);
  await prisma.registration.update({ where: { id: registrationId }, data: { status: "withdrawn" } });
  await promoteFromWaitlist(entry.tournamentId);

  /* If the draw is already made, whatever they were about to play hands to
     their opponent as a walkover. Only the matches already on a court or in the
     queue are handled here — one where the opponent isn't decided yet is left
     to `refreshMatchStates`, which forfeits it the moment somebody does arrive
     in the other slot. */
  const liveMatches = await prisma.match.findMany({
    where: {
      tournamentId: entry.tournamentId,
      status: { in: ["ready", "in_progress"] },
      OR: [{ sideARegistrationId: registrationId }, { sideBRegistrationId: registrationId }],
    },
    select: {
      id: true,
      sideARegistrationId: true,
      sideBRegistrationId: true,
    },
  });

  for (const match of liveMatches) {
    const winnerRegistrationId =
      match.sideARegistrationId === registrationId ? match.sideBRegistrationId : match.sideARegistrationId;
    await prisma.match.update({
      where: { id: match.id },
      data: { status: "walkover", winnerRegistrationId, completedAt: new Date(), courtId: null },
    });
    await settleAfterMatch(entry.tournamentId, match.id);
  }

  await refreshMatchStates(entry.tournamentId);
  await assignFreeCourts(entry.tournamentId);
  await completeIfFinished(entry.tournamentId);

  revalidateTournamentViews(entry.tournamentId);
  return { ok: true, message: "Entry withdrawn." };
}

/* ------------------------------------------------------------------ *
 * Scheduling: windows of play
 * ------------------------------------------------------------------ */

/** Statuses whose schedule an admin may still change. Once play is over the
 *  windows are a record of what happened, not a plan. */
function scheduleEditable(status: string): boolean {
  return status !== "completed" && status !== "cancelled";
}

/**
 * Create or update a window of play — "Round 1, Monday 8–10am". Saving one
 * rebuilds the court blocks, so the calendar always matches the schedule
 * rather than drifting from it.
 */
export async function saveSession(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdminOrThrow();
  const settings = await getSettings();
  const tournamentId = String(formData.get("tournamentId") ?? "");
  const sessionId = String(formData.get("sessionId") ?? "").trim();

  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { id: true, status: true },
  });
  if (!tournament) return { error: "Tournament not found." };
  if (!scheduleEditable(tournament.status)) {
    return { error: "This tournament is finished — its schedule can't be changed." };
  }

  const name = String(formData.get("name") ?? "").trim().slice(0, 60);
  if (!name) return { error: "Name the window — “Round 1”, “Sunday AM”, whatever you call it." };

  const startAt = parseLocalDateTime(formData.get("startAt"), settings.timezone);
  const endAt = parseLocalDateTime(formData.get("endAt"), settings.timezone);
  if (!startAt || !endAt) return { error: "Set when the window starts and ends." };
  if (endAt <= startAt) return { error: "A window has to end after it starts." };

  /* Overlapping windows would double-block the same courts and leave the queue
     with two open sessions at once — legal, but never what anyone means. */
  const clash = await prisma.tournamentSession.findFirst({
    where: {
      tournamentId,
      ...(sessionId ? { id: { not: sessionId } } : {}),
      startAt: { lt: endAt },
      endAt: { gt: startAt },
    },
    select: { name: true },
  });
  if (clash) return { error: `That overlaps “${clash.name}”. Windows can't share time on the same courts.` };

  if (sessionId) {
    await prisma.tournamentSession.update({ where: { id: sessionId }, data: { name, startAt, endAt } });
  } else {
    const count = await prisma.tournamentSession.count({ where: { tournamentId } });
    await prisma.tournamentSession.create({
      data: { tournamentId, name, startAt, endAt, sortOrder: count + 1 },
    });
  }

  if (tournament.status !== "draft") await syncCourtBlocks(tournamentId);
  revalidateTournamentViews(tournamentId);
  return { ok: true, message: sessionId ? "Window updated." : "Window added." };
}

/** Remove a window. Its matches fall back to unscheduled, which means they can
 *  be called any time the tournament is running — never that they're lost. */
export async function deleteSession(sessionId: string): Promise<ActionState> {
  await requireAdminOrThrow();
  const session = await prisma.tournamentSession.findUnique({
    where: { id: sessionId },
    select: { tournamentId: true, tournament: { select: { status: true } }, _count: { select: { matches: true } } },
  });
  if (!session) return { error: "Window not found." };
  if (!scheduleEditable(session.tournament.status)) {
    return { error: "This tournament is finished — its schedule can't be changed." };
  }

  // `Match.sessionId` is ON DELETE SET NULL, so the matches survive this.
  await prisma.tournamentSession.delete({ where: { id: sessionId } });
  await syncCourtBlocks(session.tournamentId);
  revalidateTournamentViews(session.tournamentId);
  return {
    ok: true,
    message:
      session._count.matches > 0
        ? `Window removed — its ${session._count.matches} ${session._count.matches === 1 ? "match is" : "matches are"} unscheduled now, so they can be called any time.`
        : "Window removed.",
  };
}

/**
 * Put a whole round into a window, which is how a schedule is normally built —
 * "round 1 is Monday 8–10". Passing an empty session unschedules the round.
 */
export async function assignRoundToSession(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdminOrThrow();
  const tournamentId = String(formData.get("tournamentId") ?? "");
  const round = parseIntField(formData.get("round"));
  const sessionId = String(formData.get("sessionId") ?? "").trim();
  if (round == null) return { error: "Pick a round." };

  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { status: true },
  });
  if (!tournament) return { error: "Tournament not found." };
  if (!scheduleEditable(tournament.status)) {
    return { error: "This tournament is finished — its schedule can't be changed." };
  }
  if (sessionId) {
    const owns = await prisma.tournamentSession.findFirst({
      where: { id: sessionId, tournamentId },
      select: { id: true },
    });
    if (!owns) return { error: "That window belongs to a different tournament." };
  }

  /* Matches already played keep whatever window they were in — rewriting
     history to match a schedule change would misreport when they happened. */
  const { count } = await prisma.match.updateMany({
    where: { tournamentId, round, status: { in: ["pending", "ready"] } },
    data: { sessionId: sessionId || null },
  });

  revalidateTournamentViews(tournamentId);
  return { ok: true, message: `${count} ${count === 1 ? "match" : "matches"} rescheduled.` };
}

/** Move one match into a window on its own — for a final you want at a set
 *  time, or a match that has to shift off a busy morning. */
export async function assignMatchToSession(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdminOrThrow();
  const matchId = String(formData.get("matchId") ?? "");
  const sessionId = String(formData.get("sessionId") ?? "").trim();

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: { tournamentId: true, status: true },
  });
  if (!match) return { error: "Match not found." };
  if (match.status === "completed" || match.status === "walkover") {
    return { error: "That match has already been played." };
  }
  if (sessionId) {
    const owns = await prisma.tournamentSession.findFirst({
      where: { id: sessionId, tournamentId: match.tournamentId },
      select: { id: true },
    });
    if (!owns) return { error: "That window belongs to a different tournament." };
  }

  await prisma.match.update({ where: { id: matchId }, data: { sessionId: sessionId || null } });
  revalidateTournamentViews(match.tournamentId);
  return { ok: true };
}

/** Staff tick the box when an entry hands over its fee; there is no online
 *  tournament payment flow yet, so this is the whole of fee tracking. */
export async function setEntryFeePaid(registrationId: string, paid: boolean): Promise<ActionState> {
  await requireAdminOrThrow();
  const entry = await prisma.registration.findUnique({
    where: { id: registrationId },
    select: { tournamentId: true },
  });
  if (!entry) return { error: "Entry not found." };

  await prisma.registration.update({ where: { id: registrationId }, data: { feePaid: paid } });
  revalidateTournamentViews(entry.tournamentId);
  return { ok: true };
}
