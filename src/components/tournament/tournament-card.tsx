import Link from "next/link";
import { CalendarDays } from "lucide-react";
import type { TournamentFormat, TournamentPlayType, TournamentStatus } from "@/generated/prisma/enums";
import { formatDateTimeLabel, formatMoney } from "@/lib/format";
import { FORMAT_LABELS, isAwaitingRegistrationOpen, PLAY_TYPE_LABELS } from "@/lib/tournament";
import { TournamentStatusBadge } from "@/components/tournament/status-badge";
import { formatSkillBand } from "@/lib/skill";
import { cn } from "@/lib/utils";

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

/** Stages where the draw is still filling, so how full it is is the fact
 *  somebody is weighing. Once play starts, the entry count is history. */
const STILL_FILLING: TournamentStatus[] = ["registration_open", "registration_closed"];

/**
 * The one line of timing that isn't the start time — always exactly one, for
 * every stage, so the line exists in the same place on every card in the grid
 * instead of appearing on some and not others.
 */
function timingNote(t: TournamentCardData, tz: string): { text: string; strong?: boolean } {
  switch (t.status) {
    case "registration_open":
      return isAwaitingRegistrationOpen(t)
        ? { text: `Entries open ${formatDateTimeLabel(t.registrationOpensAt!, tz)}`, strong: true }
        : { text: `Entries close ${formatDateTimeLabel(t.registrationClosesAt, tz)}` };
    case "registration_closed":
      return { text: "Entries closed — the draw is set" };
    case "in_progress":
      return { text: "Being played right now", strong: true };
    case "completed":
      return { text: "Played and decided" };
    case "cancelled":
      return { text: "Cancelled" };
    default:
      return { text: "Not published yet" };
  }
}

/** One fact of the bottom rail. Three of these, same three on every card, so a
 *  row of cards can be read down a column instead of hunted through. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-2 py-2.5 text-center">
      <dt className="text-[0.5625rem] font-bold uppercase tracking-[0.12em] text-muted-foreground">{label}</dt>
      <dd className="data-value mt-0.5 truncate text-xs sm:text-[0.8125rem]">{value}</dd>
    </div>
  );
}

/**
 * One tournament as it appears on the browse page.
 *
 * Every card is the same skeleton in the same order — when it plays and what
 * stage it is at, its name, what it is, one line of timing, then a rail of the
 * same three facts — so a grid of them lines up horizontally and reads as a
 * table would. Nothing about a tournament's stage is allowed to change that
 * shape: a live one is marked with the gold ring and the gold tag and is
 * otherwise built exactly like the rest.
 *
 * `footer` is one line of results (who is on court, who won), inside the card
 * rather than under it — one tournament reads as one box.
 */
export function TournamentCard({
  tournament,
  href,
  tz,
  footer,
}: {
  tournament: TournamentCardData;
  href: string;
  tz: string;
  footer?: React.ReactNode;
}) {
  const entries = tournament._count.registrations;
  const filling = STILL_FILLING.includes(tournament.status);
  const full = entries >= tournament.maxEntries;
  const filled =
    tournament.maxEntries > 0 ? Math.min(100, Math.round((entries / tournament.maxEntries) * 100)) : 0;
  const courts = tournament.courts.map((c) => c.court.name).join(", ");
  const live = tournament.status === "in_progress";
  const timing = timingNote(tournament, tz);

  return (
    /* An `<article>` with a stretched link rather than a `<Link>` wrapping
       everything: the footer names live matches and winners, and burying those
       inside an anchor makes one enormous link label for a screen reader. The
       `after` overlay keeps the whole card clickable anyway. */
    <article
      className={cn(
        "surface-card relative flex h-full flex-col overflow-hidden transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-raised focus-within:border-primary/40",
        live && "ring-1 ring-bloom/60",
      )}
    >
      <div className="flex flex-1 flex-col gap-2.5 p-4 sm:p-5">
        {/* When it plays leads, because it is the fact that decides whether the
            rest of the card is worth reading. */}
        <div className="flex items-center justify-between gap-3">
          <p className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
            <CalendarDays className="size-3.5 shrink-0 text-primary" />
            <span className="data-value truncate text-xs text-foreground">
              {formatDateTimeLabel(tournament.startAt, tz)}
            </span>
          </p>
          <TournamentStatusBadge status={tournament.status} />
        </div>

        <h3 className="line-clamp-2 text-lg leading-tight sm:text-xl">
          <Link
            href={href}
            className="rounded-sm outline-none after:absolute after:inset-0 after:content-[''] focus-visible:underline"
          >
            {tournament.name}
          </Link>
        </h3>

        {/* Format, play type and band on one line rather than as three pills:
            wrapped pills were what made a row of cards look like laundry. */}
        <p className="truncate text-[0.6875rem] font-bold uppercase tracking-[0.1em] text-muted-foreground">
          {FORMAT_LABELS[tournament.format]} · {PLAY_TYPE_LABELS[tournament.playType]} ·{" "}
          {formatSkillBand(tournament.minSkillRating, tournament.maxSkillRating)}
        </p>

        {tournament.description && (
          <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">{tournament.description}</p>
        )}

        <p
          className={cn(
            "mt-auto pt-1 text-xs",
            timing.strong ? "font-bold text-primary" : "text-muted-foreground",
          )}
        >
          {timing.text}
        </p>
      </div>

      {/* How full the draw is, as a line rather than a sentence — the same
          two pixels in the same place on every card, so a half-empty draw is
          spotted without reading a number. */}
      <div className="h-1 w-full bg-secondary" aria-hidden>
        <div
          className={cn("h-full", live ? "bg-bloom" : filling ? "bg-primary" : "bg-muted-foreground/40")}
          style={{ width: `${filled}%` }}
        />
      </div>

      <dl className="grid grid-cols-3 divide-x divide-border border-t border-border bg-secondary/40">
        <Fact
          label={full && filling ? "Waitlist open" : "Entries"}
          value={`${entries} / ${tournament.maxEntries}`}
        />
        <Fact
          label="Entry fee"
          value={tournament.entryFeeCents > 0 ? formatMoney(tournament.entryFeeCents, tournament.currency) : "Free"}
        />
        <Fact label={tournament.courts.length === 1 ? "Court" : "Courts"} value={courts || "To be called"} />
      </dl>

      {/* The results line decides for itself whether it has anything to show
          and returns null when it doesn't, so `empty:hidden` keeps a tournament
          with no result yet from growing an empty tinted band. */}
      {footer && <div className="border-t border-border px-4 py-3 empty:hidden sm:px-5">{footer}</div>}
    </article>
  );
}
