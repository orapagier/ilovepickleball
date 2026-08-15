import Link from "next/link";
import { CalendarDays, MapPin, Trophy, Users } from "lucide-react";
import type { TournamentFormat, TournamentPlayType, TournamentStatus } from "@/generated/prisma/enums";
import { formatDateTimeLabel, formatMoney } from "@/lib/format";
import { FORMAT_LABELS, isAwaitingRegistrationOpen, PLAY_TYPE_LABELS } from "@/lib/tournament";
import { TournamentChip, TournamentStatusBadge } from "@/components/tournament/status-badge";
import { formatSkillBand } from "@/lib/skill";

export type TournamentCardData = {
  id: string;
  name: string;
  description: string;
  format: TournamentFormat;
  playType: TournamentPlayType;
  minSkillRating: number | null;
  maxSkillRating: number | null;
  status: TournamentStatus;
  maxEntries: number;
  entryFeeCents: number;
  currency: string;
  startAt: Date;
  registrationOpensAt: Date | null;
  registrationClosesAt: Date;
  courts: { court: { id: number; name: string } }[];
  _count: { registrations: number };
};

/** One tournament as it appears in a list — the same card for the member browse
 *  and the admin index, so the two never drift apart on what a tournament is. */
export function TournamentCard({
  tournament,
  href,
  tz,
}: {
  tournament: TournamentCardData;
  href: string;
  tz: string;
}) {
  const entries = tournament._count.registrations;

  return (
    <Link
      href={href}
      className="surface-card flex flex-col gap-3 p-4 transition-colors hover:border-primary sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="font-display text-lg font-bold sm:text-xl">{tournament.name}</h3>
        <TournamentStatusBadge status={tournament.status} />
      </div>

      <div className="flex flex-wrap gap-1.5">
        <TournamentChip>{FORMAT_LABELS[tournament.format]}</TournamentChip>
        <TournamentChip>{PLAY_TYPE_LABELS[tournament.playType]}</TournamentChip>
        <TournamentChip>{formatSkillBand(tournament.minSkillRating, tournament.maxSkillRating)}</TournamentChip>
      </div>

      {tournament.description && (
        <p className="line-clamp-2 text-sm text-muted-foreground">{tournament.description}</p>
      )}

      <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        <div className="flex items-start gap-2">
          <CalendarDays className="mt-0.5 size-4 shrink-0 text-primary" />
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Plays</dt>
            <dd>{formatDateTimeLabel(tournament.startAt, tz)}</dd>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <Users className="mt-0.5 size-4 shrink-0 text-primary" />
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Entries</dt>
            <dd>
              {entries} of {tournament.maxEntries}
            </dd>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <Trophy className="mt-0.5 size-4 shrink-0 text-primary" />
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Entry fee</dt>
            <dd>
              {tournament.entryFeeCents > 0
                ? formatMoney(tournament.entryFeeCents, tournament.currency)
                : "Free to enter"}
            </dd>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <MapPin className="mt-0.5 size-4 shrink-0 text-primary" />
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Courts</dt>
            <dd>{tournament.courts.map((c) => c.court.name).join(", ") || "Not set"}</dd>
          </div>
        </div>
      </dl>

      {tournament.status === "registration_open" &&
        (isAwaitingRegistrationOpen(tournament) ? (
          <p className="text-xs font-semibold text-primary">
            Entries open {formatDateTimeLabel(tournament.registrationOpensAt!, tz)}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Entries close {formatDateTimeLabel(tournament.registrationClosesAt, tz)}
          </p>
        ))}
    </Link>
  );
}
