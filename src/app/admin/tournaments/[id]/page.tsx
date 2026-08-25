import Link from "next/link";
import { notFound } from "next/navigation";
import { getActiveCourts, getSettings } from "@/lib/booking-data";
import { formatDateTimeLabel, formatMoney, formatTimeOnly } from "@/lib/format";
import { ScheduleEditor } from "@/components/tournament/schedule-editor";
import {
  entryName,
  getTournamentDetail,
  toDateTimeLocalValue,
  type TournamentDetail,
} from "@/lib/tournament-data";
import {
  bracketFieldSize,
  estimateMinutes,
  FORMAT_LABELS,
  isAwaitingRegistrationOpen,
  matchesPerRound,
  playWaves,
  resolveFormatConfig,
  resolvePacing,
  totalMatchCount,
  type Pacing,
} from "@/lib/tournament";
import { EntryAdminControls, TournamentAdminActions } from "@/components/tournament/admin-actions";
import { TournamentForm } from "@/components/tournament/tournament-form";
import { TournamentStatusBadge } from "@/components/tournament/status-badge";
import { ExportLink } from "@/components/admin/export-link";

/** What happens next, in a sentence, so the status pill isn't the only thing
 *  telling an admin where the tournament is in its life. */
const NEXT_STEP: Record<string, string> = {
  draft: "Not visible to members yet. Publish it to open entries and hold the courts.",
  registration_open:
    "Members can enter. The draw is generated automatically when registration closes — or close it early below.",
  registration_closed: "The draw is made. Start play when everyone is here; matches are then called as courts free up.",
  in_progress: "Play is under way — record scores on the run-day view.",
  completed: "Finished. Results are on the member page.",
  cancelled: "Cancelled. Every entry was withdrawn and the courts released.",
};

/**
 * One row per round of the draw, with where it currently sits. Built from the
 * matches rather than from the format, so it reflects the draw that actually
 * exists — before the draw is generated there are no rounds to schedule yet.
 *
 * A round's session is whatever its unplayed matches agree on; if an admin has
 * split a round across windows by moving individual matches, the dropdown shows
 * unscheduled rather than silently picking one of them.
 */
function roundRows(tournament: TournamentDetail) {
  const rounds = [...new Set(tournament.matches.map((m) => m.round))].sort((a, b) => a - b);
  return rounds.map((round) => {
    const inRound = tournament.matches.filter((m) => m.round === round);
    const open = inRound.filter((m) => m.status === "pending" || m.status === "ready");
    const sessionIds = new Set(open.map((m) => m.sessionId));
    return {
      round,
      matchCount: inRound.length,
      played: inRound.filter((m) => m.status === "completed" || m.status === "walkover").length,
      sessionId: sessionIds.size === 1 ? ([...sessionIds][0] ?? null) : null,
    };
  });
}

/**
 * The arithmetic behind the court block, spelled out. The estimate follows the
 * draw's critical path — the closing rounds run one or two matches while the
 * other court stands idle — so the wave count, not the match count, is what
 * decides how long the day is.
 */
function SchedulePlan({
  tournament,
  tz,
  pacing,
}: {
  tournament: TournamentDetail;
  tz: string;
  pacing: Pacing;
}) {
  const drawn = tournament.matches.length > 0;
  const registered = tournament.registrations.filter(
    (r) => r.status !== "withdrawn" && r.status !== "waitlisted",
  ).length;
  // Before the draw the block is sized for a full field; after it, for the
  // field that actually turned up.
  const entries = drawn ? registered : Math.max(tournament.maxEntries, registered);
  const courtCount = tournament.courts.length || 1;

  const matches = totalMatchCount(tournament.format, entries, tournament);
  const waves = playWaves(tournament.format, entries, courtCount, tournament);
  const minutes = estimateMinutes(tournament.format, entries, courtCount, pacing, tournament);
  const perRound = matchesPerRound(tournament.format, entries, tournament);
  const config = resolveFormatConfig(tournament.format, entries, tournament);

  /* With windows the admin has already said when play happens, so the estimate
     stops being a booking decision and becomes a sanity check: does the time
     they set aside actually fit the draw? */
  const scheduled = tournament.sessions.length > 0;
  const scheduledMinutes = tournament.sessions.reduce(
    (sum, session) => sum + (session.endAt.getTime() - session.startAt.getTime()) / 60_000,
    0,
  );
  const endAt = tournament.estimatedEndAt ?? new Date(tournament.startAt.getTime() + minutes * 60_000);

  return (
    <div className="rounded-2xl bg-secondary/60 p-4 text-sm">
      <p className="font-medium">
        {drawn ? `${entries} entries` : `Sized for a full field of ${entries}`} · {matches} matches ·{" "}
        {(minutes / 60).toFixed(minutes % 60 === 0 ? 0 : 1)}h on {courtCount}{" "}
        {courtCount === 1 ? "court" : "courts"}
      </p>
      {scheduled ? (
        <p className="mt-1 text-muted-foreground">
          Courts blocked across {tournament.sessions.length} windows, {(scheduledMinutes / 60).toFixed(1)}h in total —
          {scheduledMinutes >= minutes
            ? " comfortably enough for this draw."
            : ` about ${Math.ceil((minutes - scheduledMinutes) / 60)}h short of what the draw needs, so expect to run over.`}
        </p>
      ) : (
        <p className="mt-1 text-muted-foreground">
          Courts blocked {formatDateTimeLabel(tournament.startAt, tz)} → {formatDateTimeLabel(endAt, tz)} as one
          continuous block.
        </p>
      )}
      {tournament.format === "pool_to_bracket" && (
        <p className="mt-1 text-muted-foreground">
          {config.poolCount} pools of about {Math.floor(entries / config.poolCount)}, top {config.advancePerPool} out
          of each into a knockout of {bracketFieldSize(entries, config)}.
        </p>
      )}
      {tournament.format === "swiss" && (
        <p className="mt-1 text-muted-foreground">
          {config.swissRounds} rounds, everybody plays all of them. Nobody is eliminated, so the length barely moves
          with the field size.
        </p>
      )}
      {perRound.length > 1 && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          Rounds of {perRound.join(", ")} matches — {waves} waves of play at ~
          {pacing.matchMinutes + pacing.changeoverMinutes} min each.
          {perRound.some((m) => m < courtCount) &&
            " The closing rounds only use one court, which is why this is longer than dividing matches by courts."}
        </p>
      )}
      <p className="mt-1.5 text-xs text-muted-foreground">
        {pacing.matchMinutes} min a match plus {pacing.changeoverMinutes} min changeover
        {tournament.averageMatchMinutes == null && tournament.courtChangeoverMinutes == null
          ? " (the facility default — override it below for this tournament)"
          : " (this tournament's own override)"}
        . An estimate either way: play is never driven by it, matches are called as courts free up.
      </p>
    </div>
  );
}

export default async function AdminTournamentPage(props: PageProps<"/admin/tournaments/[id]">) {
  const { id } = await props.params;
  const [tournament, courts, settings] = await Promise.all([
    getTournamentDetail(id),
    getActiveCourts(),
    getSettings(),
  ]);
  if (!tournament) notFound();

  const tz = settings.timezone;
  const entries = tournament.registrations.filter((r) => r.status !== "withdrawn");
  const registered = entries.filter((r) => r.status !== "waitlisted");
  const withdrawn = tournament.registrations.filter((r) => r.status === "withdrawn");
  const hasFee = tournament.entryFeeCents > 0;
  const awaitingOpen = isAwaitingRegistrationOpen(tournament);
  const pacing = resolvePacing(tournament, settings);

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <Link href="/admin/tournaments" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
        ← Tournaments
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold sm:text-2xl">{tournament.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {FORMAT_LABELS[tournament.format]} · plays {formatDateTimeLabel(tournament.startAt, tz)} ·{" "}
            {registered.length}/{tournament.maxEntries} entries
          </p>
        </div>
        <TournamentStatusBadge status={tournament.status} />
      </div>

      <div className="surface-card flex flex-col gap-3 p-4 sm:p-5">
        <p className="text-sm text-muted-foreground">
          {awaitingOpen
            ? `Published and listed, but nobody can enter until ${formatDateTimeLabel(tournament.registrationOpensAt!, tz)} — that's the "registration opens" date set below. Clear it to take entries straight away.`
            : NEXT_STEP[tournament.status]}
        </p>
        <TournamentAdminActions
          tournamentId={tournament.id}
          status={tournament.status}
          completedAt={tournament.completedAt}
          updatedAt={tournament.updatedAt}
        />
        <div className="flex flex-wrap gap-3 text-sm">
          <Link href={`/tournaments/${tournament.id}`} className="font-semibold text-primary hover:underline">
            Member view →
          </Link>
          {tournament.matches.length > 0 && (
            <Link href={`/admin/tournaments/${tournament.id}/run`} className="font-semibold text-primary hover:underline">
              Run day →
            </Link>
          )}
        </div>
        {/* The two sheets a tournament actually gets printed for: who is playing
            (with contact details and who still owes a fee) before the day, and
            what happened after it. */}
        {(tournament.registrations.length > 0 || tournament.matches.length > 0) && (
          <div className="flex flex-wrap items-center gap-2">
            {tournament.registrations.length > 0 && (
              <ExportLink href={`/api/admin/export/entries.csv?tournamentId=${tournament.id}`}>
                Entry list CSV
              </ExportLink>
            )}
            {tournament.matches.length > 0 && (
              <ExportLink href={`/api/admin/export/matches.csv?tournamentId=${tournament.id}`}>
                Results CSV
              </ExportLink>
            )}
          </div>
        )}
      </div>

      {/* What the court block is actually based on. Shown whether or not anyone
          has entered yet, because the block is sized off `maxEntries` at
          publish — an admin should see the worst case they're committing to
          before they commit to it, not discover it in the bookings list. */}
      {tournament.status !== "cancelled" && tournament.status !== "completed" && (
        <SchedulePlan tournament={tournament} tz={tz} pacing={pacing} />
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Entries ({registered.length} registered
          {entries.length > registered.length && `, ${entries.length - registered.length} waitlisted`})
        </h2>
        {entries.length === 0 ? (
          <p className="surface-card p-4 text-sm text-muted-foreground">Nobody has entered yet.</p>
        ) : (
          <ul className="surface-card divide-y divide-border">
            {entries.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{entryName(entry)}</p>
                  <p className="break-words text-xs text-muted-foreground">
                    {entry.status === "waitlisted" ? "Waitlisted" : entry.seed ? `Seed ${entry.seed}` : "Registered"}
                    {hasFee && ` · ${entry.feePaid ? "fee paid" : `${formatMoney(tournament.entryFeeCents, tournament.currency)} due`}`}
                    {" · "}
                    {entry.player1.email}
                    {/* What the entrant gave to account for the fee. Staff
                        settle payment by hand, so this is the thread to pull
                        on when chasing one — worth showing until it's ticked. */}
                    {hasFee && !entry.feePaid && entry.paymentReference && ` · ref ${entry.paymentReference}`}
                  </p>
                </div>
                <EntryAdminControls
                  registrationId={entry.id}
                  feePaid={entry.feePaid}
                  hasFee={hasFee}
                  withdrawable={tournament.status !== "completed" && tournament.status !== "cancelled"}
                />
              </li>
            ))}
          </ul>
        )}
        {withdrawn.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {withdrawn.length} withdrawn: {withdrawn.map((e) => entryName(e)).join(", ")}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Schedule ({tournament.sessions.length === 0 ? "one continuous block" : `${tournament.sessions.length} windows`}
          )
        </h2>
        <ScheduleEditor
          tournamentId={tournament.id}
          editable={tournament.status !== "completed" && tournament.status !== "cancelled"}
          roundNoun="Round"
          sessions={tournament.sessions.map((s) => ({
            id: s.id,
            name: s.name,
            startAt: toDateTimeLocalValue(s.startAt, tz),
            endAt: toDateTimeLocalValue(s.endAt, tz),
            label: `${formatDateTimeLabel(s.startAt, tz)} – ${formatTimeOnly(s.endAt, tz)}`,
            matchCount: s._count.matches,
          }))}
          rounds={roundRows(tournament)}
        />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Configuration</h2>
        <TournamentForm
          status={tournament.status}
          currency={tournament.currency}
          courts={courts}
          defaultPacing={{
            matchMinutes: settings.averageMatchMinutes,
            changeoverMinutes: settings.courtChangeoverMinutes,
          }}
          initial={{
            id: tournament.id,
            name: tournament.name,
            description: tournament.description,
            format: tournament.format,
            playType: tournament.playType,
            minSkillRating: tournament.minSkillRating?.toString() ?? "",
            maxSkillRating: tournament.maxSkillRating?.toString() ?? "",
            maxEntries: tournament.maxEntries,
            minEntries: tournament.minEntries,
            entryFee: (tournament.entryFeeCents / 100).toString(),
            registrationOpensAt: toDateTimeLocalValue(tournament.registrationOpensAt, tz),
            registrationClosesAt: toDateTimeLocalValue(tournament.registrationClosesAt, tz),
            startAt: toDateTimeLocalValue(tournament.startAt, tz),
            courtIds: tournament.courts.map((c) => c.courtId),
            prizeDescription: tournament.prizeDescription,
            prizes: tournament.prizes.map((p) => ({
              place: p.place,
              label: p.label,
              // Back to whole currency units, the way the form takes it.
              amount: p.amountCents == null ? "" : (p.amountCents / 100).toString(),
              description: p.description,
            })),
            averageMatchMinutes: tournament.averageMatchMinutes?.toString() ?? "",
            courtChangeoverMinutes: tournament.courtChangeoverMinutes?.toString() ?? "",
            poolCount: tournament.poolCount?.toString() ?? "",
            advancePerPool: tournament.advancePerPool?.toString() ?? "",
            swissRounds: tournament.swissRounds?.toString() ?? "",
          }}
        />
      </section>
    </div>
  );
}
