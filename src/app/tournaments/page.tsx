import Link from "next/link";
import { Plus, Trophy } from "lucide-react";
import type { TournamentFormat, TournamentStatus } from "@/generated/prisma/enums";
import { getProfileCompletion, getSessionUser } from "@/lib/auth-helpers";
import { getSettings } from "@/lib/booking-data";
import { formatDateTimeLabel } from "@/lib/format";
import { formatSkillRating, SKILL_RATINGS } from "@/lib/skill";
import { getMyTournaments, listPublicTournaments, listTournamentResults } from "@/lib/tournament-data";
import { FORMAT_LABELS, TOURNAMENT_STATUS_LABELS } from "@/lib/tournament";
import { TournamentCard } from "@/components/tournament/tournament-card";
import { ResultsLine } from "@/components/tournament/results-card";
import { TournamentFilters } from "@/components/tournament/tournament-filters";
import { LiveTag, TournamentStatusBadge } from "@/components/tournament/status-badge";
import { PageHeader } from "@/components/page-header";

const STATUS_FILTERS: TournamentStatus[] = ["registration_open", "registration_closed", "in_progress", "completed"];
// Derived from the label table rather than listed again, so a new format shows
// up in the browse filter the moment it exists.
const FORMAT_FILTERS = Object.keys(FORMAT_LABELS) as TournamentFormat[];

export default async function TournamentsPage(props: PageProps<"/tournaments">) {
  const searchParams = await props.searchParams;
  const status = typeof searchParams.status === "string" ? searchParams.status : undefined;
  const format = typeof searchParams.format === "string" ? searchParams.format : undefined;
  const skill = typeof searchParams.skill === "string" ? searchParams.skill : undefined;
  const current = { status, format, skill };

  const [settings, user] = await Promise.all([getSettings(), getSessionUser()]);
  const profile = user ? await getProfileCompletion(user.id) : null;
  // The filter takes a rating and shows what admits it, rather than listing the
  // bands themselves — "what can I actually enter" is the question being asked.
  const openToRating = skill && SKILL_RATINGS.some((r) => String(r.value) === skill) ? Number(skill) : undefined;
  const [tournaments, mine] = await Promise.all([
    listPublicTournaments({
      status: STATUS_FILTERS.includes(status as TournamentStatus) ? (status as TournamentStatus) : undefined,
      format: FORMAT_FILTERS.includes(format as TournamentFormat) ? (format as TournamentFormat) : undefined,
      openToRating,
    }),
    user ? getMyTournaments(user.id) : Promise.resolve([]),
  ]);

  /* The results line needs the entries and matches of the tournaments that have
     any — which is only the ones being played or already
     finished. One grouped fetch for all of them rather than a relation include
     on the list query, which would pull every match of every tournament ever
     run through a page that mostly wants names and dates. */
  const results = await listTournamentResults(
    tournaments.filter((t) => t.status === "in_progress" || t.status === "completed").map((t) => t.id),
  );

  const tz = settings.timezone;
  const liveCount = tournaments.filter((t) => t.status === "in_progress").length;
  const openCount = tournaments.filter((t) => t.status === "registration_open").length;

  return (
    <div className="flex flex-1 flex-col">
      {/* Members only ever browse here, so the create action lives in the admin
          area — but an admin who lands on this page shouldn't have to go find
          it, hence the shortcut. */}
      <PageHeader
        eyebrow="Club play"
        title="Tournaments"
        description="Run on our courts by the staff. Browse what's open, enter with a partner, and follow the draw live on the day."
        action={
          user?.role === "admin" && (
            <Link href="/admin/tournaments/new" className="btn btn-primary">
              <Plus className="size-4" />
              New tournament
            </Link>
          )
        }
      />

      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-7 sm:py-9">
        {/* A member's own entries come first and in full — the live "you're up"
            state is the one thing on this page that is time-critical. */}
        {mine.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-xl sm:text-2xl">Your tournaments</h2>
            <ul className="flex flex-col gap-2.5">
              {mine.map((entry) => {
                const matches = [...entry.matchesAsSideA, ...entry.matchesAsSideB];
                const onCourt = matches.find((m) => m.status === "in_progress");
                const queued = matches.filter((m) => m.status === "ready").length;
                return (
                  <li key={entry.id}>
                    <Link
                      href={`/tournaments/${entry.tournamentId}`}
                      className="surface-card flex flex-wrap items-center justify-between gap-3 p-4 transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-raised"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-bold">{entry.tournament.name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          <span className="data-value">{formatDateTimeLabel(entry.tournament.startAt, tz)}</span> ·{" "}
                          {entry.status === "waitlisted" ? "Waitlisted" : "Entered"}
                          {queued > 0 && ` · ${queued} ${queued === 1 ? "match" : "matches"} queued`}
                        </p>
                      </div>
                      {onCourt ? (
                        <LiveTag>You&rsquo;re up — {onCourt.court?.name ?? "court TBC"}</LiveTag>
                      ) : (
                        <TournamentStatusBadge status={entry.tournament.status} />
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
            {mine.some((entry) => entry.tournament.status === "in_progress") && (
              <p className="text-xs text-muted-foreground">
                Matches are called as courts free up, so keep this page open on the day.
              </p>
            )}
          </section>
        )}

        <section className="flex flex-col gap-4">
          <TournamentFilters
            current={current}
            note={
              profile?.skillRating != null ? `You're rated ${formatSkillRating(profile.skillRating)}.` : null
            }
            groups={[
              {
                key: "status",
                label: "Stage",
                allLabel: "All stages",
                options: STATUS_FILTERS.map((s) => ({ value: s, label: TOURNAMENT_STATUS_LABELS[s] })),
              },
              {
                key: "format",
                label: "Format",
                allLabel: "Any format",
                options: FORMAT_FILTERS.map((f) => ({ value: f, label: FORMAT_LABELS[f] })),
              },
              {
                key: "skill",
                label: "Level",
                allLabel: "Any level",
                // Reads as "what admits a 3.5 player", which is the question being
                // asked — not "which band is this", which is the tournament's.
                options: SKILL_RATINGS.map((r) => ({ value: String(r.value), label: `Open to ${r.label}` })),
              },
            ]}
          />

          {/* What the filters left, counted — and the two counts anyone
              scanning this page is actually after, in the order they matter. */}
          {tournaments.length > 0 && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span className="data-value text-foreground">{tournaments.length}</span>
              {tournaments.length === 1 ? "tournament" : "tournaments"}
              {liveCount > 0 && (
                <>
                  <span aria-hidden>·</span>
                  <span className="font-bold text-foreground">{liveCount} being played now</span>
                </>
              )}
              {openCount > 0 && (
                <>
                  <span aria-hidden>·</span>
                  <span className="font-bold text-primary">{openCount} taking entries</span>
                </>
              )}
            </p>
          )}
        </section>

        {tournaments.length === 0 ? (
          /* An empty screen is an invitation to act, so it ends on the thing
             there is still to do rather than on the absence. */
          <div className="surface-card flex flex-col items-center gap-4 px-6 py-14 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-primary/10">
              <Trophy className="size-6 text-primary" />
            </span>
            <div>
              <p className="text-lg font-bold">No tournaments match those filters</p>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Nothing is scheduled in that bracket yet. Courts are open in the meantime.
              </p>
            </div>
            <Link href="/book" className="btn btn-primary mt-1">
              Book a court
            </Link>
          </div>
        ) : (
          /* Stretched rows, not `items-start`: every card is the same skeleton
             now, so letting them fill the row height lines their rails up
             across the grid instead of leaving each one to end where its own
             description happens to stop. */
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {tournaments.map((t) => {
              const result = results.get(t.id);
              /* The result rides *inside* the card as one line of footer rather
                 than under it as a second card — one tournament, one box. */
              const footer = result ? (
                <ResultsLine tournament={t} registrations={result.registrations} matches={result.matches} />
              ) : null;

              return (
                <li key={t.id}>
                  <TournamentCard tournament={t} href={`/tournaments/${t.id}`} tz={tz} footer={footer} />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
