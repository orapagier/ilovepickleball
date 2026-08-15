import Link from "next/link";
import { Plus, Trophy } from "lucide-react";
import type { TournamentFormat, TournamentStatus } from "@/generated/prisma/enums";
import { getProfileCompletion, getSessionUser } from "@/lib/auth-helpers";
import { getSettings } from "@/lib/booking-data";
import { formatDateTimeLabel } from "@/lib/format";
import { formatSkillRating, SKILL_RATINGS } from "@/lib/skill";
import { getMyTournaments, listPublicTournaments } from "@/lib/tournament-data";
import { FORMAT_LABELS, TOURNAMENT_STATUS_LABELS } from "@/lib/tournament";
import { TournamentCard } from "@/components/tournament/tournament-card";
import { TournamentFilters } from "@/components/tournament/tournament-filters";
import { TournamentStatusBadge } from "@/components/tournament/status-badge";

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

  const tz = settings.timezone;

  /* A member's own entries come first and in full — the live "you're up" state
     is the one thing on this page that is time-critical. */
  const liveEntries = mine.filter((entry) => entry.tournament.status === "in_progress");

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-3 py-6 sm:px-4 sm:py-8">
      {/* Members only ever browse here, so the create action lives in the admin
          area — but an admin who lands on this page shouldn't have to go find
          it, hence the shortcut. */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold sm:text-3xl">Tournaments</h1>
          <p className="mt-1.5 text-xs text-muted-foreground sm:text-sm">
            Run on our courts by the staff — browse what&rsquo;s open, enter with a partner, and follow the draw live
            on the day.
          </p>
        </div>
        {user?.role === "admin" && (
          <Link
            href="/admin/tournaments/new"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90"
          >
            <Plus className="size-4" />
            New tournament
          </Link>
        )}
      </div>

      {mine.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-lg font-bold sm:text-xl">Your tournaments</h2>
          <ul className="flex flex-col gap-2">
            {mine.map((entry) => {
              const matches = [...entry.matchesAsSideA, ...entry.matchesAsSideB];
              const onCourt = matches.find((m) => m.status === "in_progress");
              const queued = matches.filter((m) => m.status === "ready").length;
              return (
                <li key={entry.id}>
                  <Link
                    href={`/tournaments/${entry.tournamentId}`}
                    className="surface-card flex flex-wrap items-center justify-between gap-3 p-4 transition-colors hover:border-primary"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{entry.tournament.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTimeLabel(entry.tournament.startAt, tz)} ·{" "}
                        {entry.status === "waitlisted" ? "Waitlisted" : "Entered"}
                        {queued > 0 && ` · ${queued} ${queued === 1 ? "match" : "matches"} queued`}
                      </p>
                    </div>
                    {onCourt ? (
                      <span className="rounded-full border border-success/30 bg-success/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-success">
                        You&rsquo;re up — {onCourt.court?.name ?? "court TBC"}
                      </span>
                    ) : (
                      <TournamentStatusBadge status={entry.tournament.status} />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
          {liveEntries.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Matches are called as courts free up, so keep this page open on the day.
            </p>
          )}
        </section>
      )}

      <TournamentFilters
        current={current}
        note={
          profile?.skillRating != null
            ? `You're rated ${formatSkillRating(profile.skillRating)}.`
            : null
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

      {tournaments.length === 0 ? (
        <div className="surface-card flex flex-col items-center gap-3 p-8 text-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-primary/10">
            <Trophy className="size-5 text-primary" />
          </span>
          <p className="text-sm text-muted-foreground">
            Nothing scheduled that matches those filters yet. Check back — or{" "}
            <Link href="/book" className="font-semibold text-primary hover:underline">
              book a court
            </Link>{" "}
            in the meantime.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {tournaments.map((t) => (
            <li key={t.id} className="contents">
              <TournamentCard tournament={t} href={`/tournaments/${t.id}`} tz={tz} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

