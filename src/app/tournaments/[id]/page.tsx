import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, CalendarDays, ChevronLeft, Coins, Info, MapPin, Trophy, Users } from "lucide-react";
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
import { PrizeList, WinnersCard } from "@/components/tournament/results-card";
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
    <div className="flex flex-1 flex-col">
      <header className="dusk-panel">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3.5 px-4 pb-9 pt-5 sm:pb-11">
          <Link
            href="/tournaments"
            className="inline-flex w-fit items-center gap-1.5 text-sm font-bold text-dusk-foreground/70 transition-colors hover:text-dusk-foreground"
          >
            <ChevronLeft className="size-4" />
            All tournaments
          </Link>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h1 className="text-3xl sm:text-4xl">{tournament.name}</h1>
            {/* The status stays `registration_open` from publish onward, so a
                tournament waiting on its opening date would otherwise be badged
                as taking entries it won't accept. */}
            {awaitingOpen ? (
              <TournamentChip className="bg-white/15 text-dusk-foreground">
                Opens {formatDateTimeLabel(tournament.registrationOpensAt!, tz)}
              </TournamentChip>
            ) : (
              <TournamentStatusBadge status={tournament.status} />
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <TournamentChip className="bg-white/12 text-dusk-foreground">
              {FORMAT_LABELS[tournament.format]}
            </TournamentChip>
            <TournamentChip className="bg-white/12 text-dusk-foreground">
              {PLAY_TYPE_LABELS[tournament.playType]}
            </TournamentChip>
            <TournamentChip className="bg-white/12 text-dusk-foreground">
              {formatSkillBand(tournament.minSkillRating, tournament.maxSkillRating)}
            </TournamentChip>
          </div>
          {tournament.description && (
            <p className="max-w-prose text-sm leading-relaxed text-dusk-foreground/75 sm:text-base">
              {tournament.description}
            </p>
          )}
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6 sm:py-8">
      {/* The one time-critical thing on this page, in the one colour this app
          keeps for things happening this minute. */}
      {myLiveMatch && (
        <div className="flex items-center gap-3 rounded-2xl bg-bloom p-4 text-bloom-foreground shadow-raised">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-bloom-foreground/15">
            <Trophy className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="font-bold">You&rsquo;re up — {myLiveMatch.court?.name ?? "court to be called"}</p>
            <p className="text-sm opacity-80">
              {entryName(myLiveMatch.sideA!)} vs {entryName(myLiveMatch.sideB!)}
            </p>
          </div>
        </div>
      )}

      {/* One panel divided into cells, not six separate cards. Six bordered,
          shadowed boxes floating in a grid gave the top of this page a scattered
          look and repeated the same frame six times to say one thing: here are
          the facts. The `gap-px` over a border-coloured background draws
          hairlines between the cells at every breakpoint without any per-cell
          border juggling. */}
      <dl className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border shadow-card sm:grid-cols-2 lg:grid-cols-3">
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

      {/* Once it is over the prizes stop being an advertisement and become a
          result: who took which one. Before that they are the advertisement, and
          are exactly what a member weighing up the entry fee is looking for — so
          the same table renders as two different things either side of the last
          match. */}
      {tournament.status === "completed" && tournament.matches.length > 0 && (
        <WinnersCard
          tournament={tournament}
          registrations={tournament.registrations}
          matches={tournament.matches}
          prizes={tournament.prizes}
        />
      )}

      {(tournament.prizeDescription || (tournament.prizes.length > 0 && tournament.status !== "completed")) && (
        <div className="surface-card p-4 sm:p-5">
          <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Prizes</h3>
          {tournament.status !== "completed" && (
            <PrizeList prizes={tournament.prizes} currency={tournament.currency} className="mt-2" />
          )}
          {tournament.prizeDescription && (
            <p className={tournament.prizes.length > 0 ? "mt-3 text-sm text-muted-foreground" : "mt-1.5 text-sm"}>
              {tournament.prizeDescription}
            </p>
          )}
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
            className="btn btn-primary"
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
          <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
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
          <h2 className="text-xl sm:text-2xl">Schedule</h2>
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
                    <span className="shrink-0 rounded-full bg-primary/12 px-2.5 py-1 text-[0.6875rem] font-bold uppercase tracking-[0.1em] text-primary">
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
        <h2 className="text-xl sm:text-2xl">
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
    </div>
  );
}

function Fact({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 bg-card p-4 sm:p-5">
      <span className="mt-0.5 text-primary">{icon}</span>
      <div className="min-w-0">
        <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</dt>
        <dd className="text-sm font-bold">{children}</dd>
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
            <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
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
      <h2 className="text-xl sm:text-2xl">Matches</h2>
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
