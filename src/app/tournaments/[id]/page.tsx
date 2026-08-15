import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, CalendarDays, Coins, Info, MapPin, Trophy, Users } from "lucide-react";
import { getSessionUser, getProfileCompletion } from "@/lib/auth-helpers";
import { getSettings } from "@/lib/booking-data";
import { formatDateTimeLabel, formatMoney, formatTimeOnly } from "@/lib/format";
import { entryName, getTournamentDetail, type TournamentDetail } from "@/lib/tournament-data";
import {
  canSelfWithdraw,
  FORMAT_LABELS,
  isAwaitingRegistrationOpen,
  isJoinable,
  PLAY_TYPE_LABELS,
  resolveFormatConfig,
  totalMatchCount,
} from "@/lib/tournament";
import { SignInButton } from "@/components/auth-buttons";
import { Bracket } from "@/components/tournament/bracket";
import { JoinPanel, type PayeeAccount, type SkillBlock } from "@/components/tournament/join-panel";
import { PoolTables, StandingsTable } from "@/components/tournament/standings-table";
import { TournamentChip, TournamentStatusBadge } from "@/components/tournament/status-badge";
import { canEnterAtRating, formatSkillBand, formatSkillRating, hasSkillBand } from "@/lib/skill";

/** Why the enter button isn't there, said plainly rather than left blank. */
function closedReason(status: string, opensAt: Date | null, tz: string): string {
  if (status === "draft") return "This tournament hasn't been published yet.";
  if (status === "cancelled") return "This tournament was cancelled. Any entry fee paid is being refunded.";
  if (status === "completed") return "This tournament is over — the results are below.";
  if (status === "in_progress") return "Play is under way, so entries are closed.";
  if (status === "registration_closed") return "Registration has closed and the draw is made.";
  if (opensAt && opensAt > new Date()) return `Entries open ${formatDateTimeLabel(opensAt, tz)}.`;
  return "Entries have closed for this tournament.";
}

export default async function TournamentDetailPage(props: PageProps<"/tournaments/[id]">) {
  const { id } = await props.params;
  const [tournament, settings, user] = await Promise.all([
    getTournamentDetail(id),
    getSettings(),
    getSessionUser(),
  ]);
  if (!tournament || tournament.status === "draft") notFound();

  const tz = settings.timezone;
  const profile = user ? await getProfileCompletion(user.id) : null;
  const needsRegistration = profile ? !profile.complete : false;
  const skillBand = hasSkillBand(tournament.minSkillRating, tournament.maxSkillRating)
    ? formatSkillBand(tournament.minSkillRating, tournament.maxSkillRating)
    : null;

  /* Settled here rather than in the panel so the enter form is never rendered
     to somebody the action would refuse. The fee is paid by hand before
     anything confirms the entry, so a refusal that arrives after the form is a
     refusal that arrives after the money. */
  const verdict =
    profile && skillBand
      ? canEnterAtRating(profile.skillRating, tournament.minSkillRating, tournament.maxSkillRating)
      : { ok: true as const };
  const skillBlock: SkillBlock | null =
    verdict.ok || !skillBand
      ? null
      : verdict.reason === "unrated"
        ? { reason: "unrated", band: skillBand }
        : { reason: "outside", band: skillBand, rating: formatSkillRating(profile!.skillRating) };

  /* Only accounts the club has actually filled in — an empty one shown as a
     payee reads as an instruction to send money nowhere. */
  const payeeAccounts: PayeeAccount[] = [
    { label: "GCash", name: settings.gcashName, number: settings.gcashNumber },
    { label: "BDO", name: settings.bdoAccountName, number: settings.bdoAccountNumber },
    { label: "QRPh", name: settings.qrphAccountName, number: settings.qrphAccountNumber },
  ].filter((a) => a.name.trim() && a.number.trim());

  const inDraw = tournament.registrations.filter((r) => r.status !== "withdrawn" && r.status !== "waitlisted");
  const waitlisted = tournament.registrations.filter((r) => r.status === "waitlisted");
  const myEntry = user
    ? tournament.registrations.find(
        (r) => r.status !== "withdrawn" && (r.player1.id === user.id || r.player2?.id === user.id),
      )
    : undefined;

  const joinable = isJoinable(tournament);
  const awaitingOpen = isAwaitingRegistrationOpen(tournament);
  const withdrawable = canSelfWithdraw(tournament);
  const drawn = tournament.matches.length > 0;

  /* The one time-critical thing on this page: a member whose match has just
     been called to a court. It goes above everything else for that reason. */
  const myLiveMatch = myEntry
    ? tournament.matches.find(
        (m) =>
          m.status === "in_progress" &&
          (m.sideARegistrationId === myEntry.id || m.sideBRegistrationId === myEntry.id),
      )
    : undefined;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-3 py-6 sm:px-4 sm:py-8">
      <div className="flex flex-col gap-3">
        <Link href="/tournaments" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
          ← All tournaments
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="font-display text-2xl font-bold sm:text-3xl">{tournament.name}</h1>
          {/* The status stays `registration_open` from publish onward, so a
              tournament waiting on its opening date would otherwise be badged
              as taking entries it won't accept. */}
          {awaitingOpen ? (
            <TournamentChip className="border-primary/30 bg-primary/10 text-primary">
              Opens {formatDateTimeLabel(tournament.registrationOpensAt!, tz)}
            </TournamentChip>
          ) : (
            <TournamentStatusBadge status={tournament.status} />
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <TournamentChip>{FORMAT_LABELS[tournament.format]}</TournamentChip>
          <TournamentChip>{PLAY_TYPE_LABELS[tournament.playType]}</TournamentChip>
          <TournamentChip>{formatSkillBand(tournament.minSkillRating, tournament.maxSkillRating)}</TournamentChip>
        </div>
        {tournament.description && (
          <p className="max-w-prose text-sm text-muted-foreground sm:text-base">{tournament.description}</p>
        )}
      </div>

      {myLiveMatch && (
        <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success/10 p-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-success/20">
            <Trophy className="size-5 text-success" />
          </span>
          <div className="min-w-0">
            <p className="font-bold text-success">
              You&rsquo;re up — {myLiveMatch.court?.name ?? "court to be called"}
            </p>
            <p className="text-sm text-muted-foreground">
              {entryName(myLiveMatch.sideA!)} vs {entryName(myLiveMatch.sideB!)}
            </p>
          </div>
        </div>
      )}

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Fact icon={<CalendarDays className="size-4" />} label="Play starts">
          {formatDateTimeLabel(tournament.startAt, tz)}
        </Fact>
        <Fact icon={<CalendarClock className="size-4" />} label="Entries close">
          {formatDateTimeLabel(tournament.registrationClosesAt, tz)}
        </Fact>
        <Fact icon={<Users className="size-4" />} label="Entries">
          {inDraw.length} of {tournament.maxEntries}
          {waitlisted.length > 0 && ` · ${waitlisted.length} waitlisted`}
        </Fact>
        <Fact icon={<Coins className="size-4" />} label="Entry fee">
          {tournament.entryFeeCents > 0
            ? formatMoney(tournament.entryFeeCents, tournament.currency)
            : "Free to enter"}
        </Fact>
        <Fact icon={<MapPin className="size-4" />} label="Courts">
          {tournament.courts.map((c) => c.court.name).join(", ") || "Not set"}
        </Fact>
        <Fact icon={<Trophy className="size-4" />} label="Matches">
          {drawn
            ? `${tournament.matches.length} in the draw`
            : `About ${totalMatchCount(tournament.format, inDraw.length || tournament.maxEntries, tournament)} expected`}
        </Fact>
      </dl>

      {tournament.prizeDescription && (
        <div className="surface-card p-4 sm:p-5">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Prizes</h3>
          <p className="mt-1.5 text-sm">{tournament.prizeDescription}</p>
        </div>
      )}

      {/* Sign-in and profile-completion stay on the server so the client bundle
          only ever carries the form a member can actually submit. */}
      {!user ? (
        joinable && (
          <div className="surface-card flex flex-col items-start gap-3 p-4 sm:p-5">
            <p className="text-sm text-muted-foreground">Sign in to enter this tournament.</p>
            <SignInButton callbackUrl={`/tournaments/${tournament.id}`} />
          </div>
        )
      ) : needsRegistration && joinable && !myEntry ? (
        <div className="surface-card flex flex-col items-start gap-3 p-4 sm:p-5">
          <p className="text-sm text-muted-foreground">
            We need your name and mobile number before you can enter — the same details a booking needs.
          </p>
          <Link
            href={`/register?callbackUrl=/tournaments/${tournament.id}`}
            className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90"
          >
            Complete profile
          </Link>
        </div>
      ) : (
        <JoinPanel
          tournamentId={tournament.id}
          isDoubles={tournament.playType === "doubles"}
          entryStatus={(myEntry?.status as "registered" | "waitlisted" | "checked_in" | "no_show") ?? null}
          joinable={joinable}
          withdrawable={withdrawable}
          entryFeeLabel={
            tournament.entryFeeCents > 0 ? formatMoney(tournament.entryFeeCents, tournament.currency) : null
          }
          payeeAccounts={payeeAccounts}
          skillBlock={skillBlock}
        />
      )}

      {/* Where the enter button would have been. It gets the same weight as the
          button it stands in for — a member who can't join needs to be told
          why, not left to notice the absence of a control. */}
      {!joinable && !myEntry && (
        <div className="surface-card flex items-start gap-3 p-4 sm:p-5">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
            {awaitingOpen ? (
              <CalendarClock className="size-4 text-primary" />
            ) : (
              <Info className="size-4 text-primary" />
            )}
          </span>
          <div>
            <p className="font-semibold">{awaitingOpen ? "Entries haven't opened yet" : "Entries are closed"}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {closedReason(tournament.status, tournament.registrationOpensAt, tz)}
            </p>
          </div>
        </div>
      )}

      {/* When play is spread across windows, which day you're on matters more
          than anything else on this page — so it comes before the draw. */}
      {tournament.sessions.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-lg font-bold sm:text-xl">Schedule</h2>
          <ul className="surface-card divide-y divide-border">
            {tournament.sessions.map((session) => {
              const inSession = tournament.matches.filter((m) => m.sessionId === session.id);
              const mine = myEntry
                ? inSession.filter(
                    (m) => m.sideARegistrationId === myEntry.id || m.sideBRegistrationId === myEntry.id,
                  )
                : [];
              return (
                <li key={session.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{session.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTimeLabel(session.startAt, tz)} – {formatTimeOnly(session.endAt, tz)}
                      {inSession.length > 0 &&
                        ` · ${inSession.length} ${inSession.length === 1 ? "match" : "matches"}`}
                    </p>
                  </div>
                  {mine.length > 0 && (
                    <span className="shrink-0 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                      You play here
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground">
            Matches are called as courts free up within each window, so turn up at the start of yours rather than to a
            fixed match time.
          </p>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-bold sm:text-xl">
          {drawn ? resultsHeading(tournament.format) : "Entries"}
        </h2>

        {drawn ? (
          <ResultsView tournament={tournament} />
        ) : inDraw.length === 0 ? (
          <p className="surface-card p-6 text-center text-sm text-muted-foreground">
            No entries yet — be the first.
          </p>
        ) : (
          <ul className="surface-card divide-y divide-border">
            {inDraw.map((entry, i) => (
              <li key={entry.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="truncate">{entryName(entry)}</span>
                <span className="shrink-0 text-xs text-muted-foreground">#{i + 1}</span>
              </li>
            ))}
            {waitlisted.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm text-muted-foreground"
              >
                <span className="truncate">{entryName(entry)}</span>
                <span className="shrink-0 text-xs">Waitlist</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {drawn && showsMatchList(tournament.format) && <MatchList tournament={tournament} />}
    </div>
  );
}

function Fact({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="surface-card flex items-start gap-2.5 p-3.5">
      <span className="mt-0.5 text-primary">{icon}</span>
      <div className="min-w-0">
        <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</dt>
        <dd className="text-sm font-medium">{children}</dd>
      </div>
    </div>
  );
}

/** What the results section is called, which depends on what is actually in it. */
function resultsHeading(format: TournamentDetail["format"]): string {
  if (format === "single_elimination" || format === "double_elimination") return "Bracket";
  if (format === "pool_to_bracket") return "Pools and knockout";
  return "Standings";
}

/** A table format has no bracket to read the results off, so the match list is
 *  the results view. A bracket already shows every match, so it doesn't need one. */
function showsMatchList(format: TournamentDetail["format"]): boolean {
  return format === "round_robin" || format === "swiss";
}

/**
 * The results, in whatever shape the format actually has: a bracket to follow,
 * a table to read, or — for pools into a knockout — a table per pool and then a
 * bracket, which is the order they happen in.
 */
function ResultsView({ tournament }: { tournament: TournamentDetail }) {
  if (tournament.format === "single_elimination" || tournament.format === "double_elimination") {
    return <Bracket matches={tournament.matches} />;
  }

  if (tournament.format === "pool_to_bracket") {
    const config = resolveFormatConfig("pool_to_bracket", tournament.registrations.length, tournament);
    const knockout = tournament.matches.filter((m) => m.pool == null);
    return (
      <div className="flex flex-col gap-5">
        <PoolTables
          registrations={tournament.registrations}
          matches={tournament.matches}
          advancePerPool={config.advancePerPool}
        />
        {knockout.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Knockout
            </h3>
            <Bracket matches={knockout} />
          </section>
        ) : (
          <p className="text-xs text-muted-foreground">
            The knockout is drawn from these tables once every pool match has been played.
          </p>
        )}
      </div>
    );
  }

  return <StandingsTable registrations={tournament.registrations} matches={tournament.matches} />;
}

/** The match list, sorted the way the queue runs them. */
function MatchList({
  tournament,
}: {
  tournament: TournamentDetail;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-lg font-bold sm:text-xl">Matches</h2>
      <ul className="surface-card divide-y divide-border">
        {tournament.matches.map((match) => (
          <li key={match.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
            <span className="min-w-0 truncate">
              {match.sideA ? entryName(match.sideA) : "—"} vs {match.sideB ? entryName(match.sideB) : "—"}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {match.status === "completed"
                ? match.score
                : match.status === "walkover"
                  ? "Walkover"
                  : match.status === "in_progress"
                    ? `On ${match.court?.name ?? "court"}`
                    : "Queued"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
