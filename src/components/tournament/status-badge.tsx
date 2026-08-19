import type { MatchStatus, TournamentStatus } from "@/generated/prisma/enums";
import { MATCH_STATUS_LABELS, TOURNAMENT_STATUS_LABELS } from "@/lib/tournament";
import { cn } from "@/lib/utils";

/**
 * Lifecycle tags.
 *
 * One stage is loud and the rest are quiet. Anything being played *right now*
 * carries the bloom gold on a solid fill — the site's one accent, and this is
 * the only place it is spent outside the hero. It means the ball is in the air,
 * which is exactly what `in_progress` is. Every other stage is a soft tinted
 * pill that stays out of the way, because a grid where six tags shout is a grid
 * where none of them do.
 */
const TOURNAMENT_TONE: Record<TournamentStatus, string> = {
  draft: "bg-secondary text-muted-foreground",
  registration_open: "bg-primary/12 text-primary",
  registration_closed: "bg-secondary text-secondary-foreground",
  in_progress: "bg-bloom text-bloom-foreground",
  completed: "bg-transparent text-muted-foreground ring-1 ring-border ring-inset",
  cancelled: "bg-destructive/12 text-destructive",
};

const MATCH_TONE: Record<MatchStatus, string> = {
  pending: "bg-transparent text-muted-foreground ring-1 ring-border ring-inset",
  ready: "bg-primary/12 text-primary",
  in_progress: "bg-bloom text-bloom-foreground",
  completed: "bg-secondary text-secondary-foreground",
  walkover: "bg-transparent text-muted-foreground ring-1 ring-border ring-inset",
};

/** Stages that mean "this is happening now", and so get the live dot. */
const LIVE: readonly string[] = ["in_progress"];

const BASE =
  "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.625rem] font-bold uppercase leading-4 tracking-[0.1em] sm:text-[0.6875rem]";

function Dot() {
  return <span className="bloom-pulse size-1.5 shrink-0 rounded-full bg-current" aria-hidden />;
}

export function TournamentStatusBadge({ status, className }: { status: TournamentStatus; className?: string }) {
  return (
    <span className={cn(BASE, TOURNAMENT_TONE[status], className)}>
      {LIVE.includes(status) && <Dot />}
      {TOURNAMENT_STATUS_LABELS[status]}
    </span>
  );
}

export function MatchStatusBadge({ status, className }: { status: MatchStatus; className?: string }) {
  return (
    <span className={cn(BASE, MATCH_TONE[status], className)}>
      {LIVE.includes(status) && <Dot />}
      {MATCH_STATUS_LABELS[status]}
    </span>
  );
}

/** Plain neutral tag for the facts that aren't a status — format, play type,
 *  skill band. Same shape so a card's row of tags stays even. */
export function TournamentChip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn(BASE, "bg-secondary font-bold text-secondary-foreground", className)}>{children}</span>
  );
}

/** The one thing on a page that is happening this minute — a member's own match
 *  called to a court. Gold, pulsing, and never used for anything else. */
export function LiveTag({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn(BASE, "bg-bloom text-bloom-foreground", className)}>
      <Dot />
      {children}
    </span>
  );
}
