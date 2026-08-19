import Link from "next/link";
import { notFound } from "next/navigation";
import { getSettings } from "@/lib/booking-data";
import { formatDateTimeShort } from "@/lib/format";
import { BRACKET_LABELS } from "@/lib/tournament";
import { entryName, getTournamentDetail, type TournamentMatch } from "@/lib/tournament-data";
import { FORMAT_LABELS } from "@/lib/tournament";
import { MatchStatusBadge, TournamentStatusBadge } from "@/components/tournament/status-badge";
import { AssignCourtForm, RecordScoreForm, WalkoverForm } from "@/components/tournament/run-day-controls";

function sideName(side: TournamentMatch["sideA"]): string {
  return side ? entryName(side) : "TBC";
}

/**
 * Run day: one column per court showing what's on it, the queue underneath, and
 * a score box on every live match. Recording a result is the only thing staff
 * have to do — the freed court refills itself from the queue.
 */
/** Where a match sits, in the terms the format actually uses: which bracket in
 *  a double-elimination draw, which pool in a pool stage, otherwise the round. */
function matchWhere(match: { round: number; matchNumber: number; bracket: string | null; pool: number | null }): string {
  const position = `round ${match.round}, match ${match.matchNumber}`;
  if (match.bracket) return `${BRACKET_LABELS[match.bracket as keyof typeof BRACKET_LABELS]} · ${position}`;
  if (match.pool != null) return `pool ${match.pool} · ${position}`;
  return position;
}

export default async function TournamentRunPage(props: PageProps<"/admin/tournaments/[id]/run">) {
  const { id } = await props.params;
  const [tournament, settings] = await Promise.all([getTournamentDetail(id), getSettings()]);
  if (!tournament) notFound();

  const tz = settings.timezone;
  const now = new Date();
  const courts = tournament.courts.map((c) => c.court);
  const openSession = tournament.sessions.find((s) => now >= s.startAt && now < s.endAt) ?? null;
  const live = tournament.matches.filter((m) => m.status === "in_progress");
  const queued = tournament.matches.filter((m) => m.status === "ready");
  const waiting = tournament.matches.filter((m) => m.status === "pending");
  const done = tournament.matches.filter((m) => m.status === "completed" || m.status === "walkover");

  return (
    <div className="flex flex-col gap-5">
      <Link
        href={`/admin/tournaments/${tournament.id}`}
        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        ← {tournament.name}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Run day</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {FORMAT_LABELS[tournament.format]} · {done.length} of {tournament.matches.length} matches played
          </p>
        </div>
        <TournamentStatusBadge status={tournament.status} />
      </div>

      {/* Which window is live decides what the queue will call, so it belongs
          at the top of the view that runs the day. */}
      {tournament.sessions.length > 0 && (
        <p className="rounded-2xl bg-secondary/60 p-4 text-sm text-muted-foreground">
          {openSession ? (
            <>
              Now playing <strong className="text-foreground">{openSession.name}</strong>, until{" "}
              {formatDateTimeShort(openSession.endAt, tz)}. Only matches in this window are called automatically —
              anything else you can still send to a court by hand.
            </>
          ) : (
            <>
              No window is open right now, so nothing is called automatically. Next up:{" "}
              <strong className="text-foreground">
                {tournament.sessions.find((s) => s.startAt > now)?.name ?? "nothing scheduled"}
              </strong>
              {tournament.sessions.find((s) => s.startAt > now) &&
                ` at ${formatDateTimeShort(tournament.sessions.find((s) => s.startAt > now)!.startAt, tz)}`}
              .
            </>
          )}
        </p>
      )}

      {tournament.status === "registration_closed" && (
        <p className="rounded-2xl bg-secondary/60 p-4 text-sm text-muted-foreground">
          The draw is made but play hasn&rsquo;t started. Hit <strong>Start play</strong> on the tournament page and the
          first matches go straight onto the courts.
        </p>
      )}

      <section className="grid gap-3 sm:grid-cols-2">
        {courts.map((court) => {
          const match = live.find((m) => m.courtId === court.id);
          return (
            <div key={court.id} className="surface-card flex flex-col gap-3 p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-bold">{court.name}</h2>
                {match ? (
                  <MatchStatusBadge status="in_progress" />
                ) : (
                  <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Free
                  </span>
                )}
              </div>

              {match ? (
                <>
                  <div>
                    <p className="text-sm font-semibold">{sideName(match.sideA)}</p>
                    <p className="my-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      vs
                    </p>
                    <p className="text-sm font-semibold">{sideName(match.sideB)}</p>
                    {match.scheduledAt && (
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        On since {formatDateTimeShort(match.scheduledAt, tz)}
                      </p>
                    )}
                  </div>

                  {match.sideARegistrationId && match.sideBRegistrationId && (
                    <>
                      <RecordScoreForm
                        matchId={match.id}
                        sideA={{ registrationId: match.sideARegistrationId, name: sideName(match.sideA) }}
                        sideB={{ registrationId: match.sideBRegistrationId, name: sideName(match.sideB) }}
                      />
                      <WalkoverForm
                        matchId={match.id}
                        sideAName={sideName(match.sideA)}
                        sideBName={sideName(match.sideB)}
                      />
                    </>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {queued.length > 0
                    ? "Nothing on this court — the next queued match takes it as soon as a result is recorded, or send one over from the queue below."
                    : "Nothing waiting to play."}
                </p>
              )}
            </div>
          );
        })}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Queue ({queued.length})
        </h2>
        {queued.length === 0 ? (
          <p className="surface-card p-4 text-sm text-muted-foreground">
            {waiting.length > 0
              ? `${waiting.length} ${waiting.length === 1 ? "match is" : "matches are"} still waiting on results from earlier rounds.`
              : "Nothing queued."}
          </p>
        ) : (
          <ul className="surface-card divide-y divide-border">
            {queued.map((match, i) => (
              <li key={match.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {sideName(match.sideA)} vs {sideName(match.sideB)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {i === 0 ? "Up next" : `#${i + 1} in line`} · {matchWhere(match)}
                    {/* A match outside its window is queued but won't be called
                        on its own, so the queue has to say so — otherwise a
                        court sitting empty looks like a bug. */}
                    {match.session &&
                      (now >= match.session.startAt && now < match.session.endAt
                        ? ` · ${match.session.name}`
                        : ` · waits for ${match.session.name}, ${formatDateTimeShort(match.session.startAt, tz)}`)}
                  </p>
                </div>
                <AssignCourtForm matchId={match.id} courts={courts} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {done.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Played ({done.length})
          </h2>
          <ul className="surface-card divide-y divide-border">
            {done.map((match) => (
              <li key={match.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span className="min-w-0 truncate">
                  {sideName(match.sideA)} vs {sideName(match.sideB)}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {match.status === "walkover" ? "Walkover" : match.score}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
