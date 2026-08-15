import type { MatchStatus, TournamentStatus } from "@/generated/prisma/enums";
import { MATCH_STATUS_LABELS, TOURNAMENT_STATUS_LABELS } from "@/lib/tournament";
import { cn } from "@/lib/utils";

/** One pill style per lifecycle stage: live things carry the primary hue,
 *  finished things go quiet, and a cancellation is the only destructive one. */
const TOURNAMENT_TONE: Record<TournamentStatus, string> = {
  draft: "border-border bg-secondary/60 text-muted-foreground",
  registration_open: "border-primary/30 bg-primary/10 text-primary",
  registration_closed: "border-border bg-secondary text-foreground",
  in_progress: "border-success/30 bg-success/10 text-success",
  completed: "border-border bg-secondary/60 text-muted-foreground",
  cancelled: "border-destructive/30 bg-destructive/10 text-destructive",
};

const MATCH_TONE: Record<MatchStatus, string> = {
  pending: "border-border bg-secondary/60 text-muted-foreground",
  ready: "border-primary/30 bg-primary/10 text-primary",
  in_progress: "border-success/30 bg-success/10 text-success",
  completed: "border-border bg-secondary text-foreground",
  walkover: "border-border bg-secondary/60 text-muted-foreground",
};

const BASE =
  "inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] sm:text-[11px]";

export function TournamentStatusBadge({ status, className }: { status: TournamentStatus; className?: string }) {
  return <span className={cn(BASE, TOURNAMENT_TONE[status], className)}>{TOURNAMENT_STATUS_LABELS[status]}</span>;
}

export function MatchStatusBadge({ status, className }: { status: MatchStatus; className?: string }) {
  return <span className={cn(BASE, MATCH_TONE[status], className)}>{MATCH_STATUS_LABELS[status]}</span>;
}

/** Plain neutral pill for the facts that aren't a status — format, play type,
 *  skill band. Same shape so a card's row of chips stays even. */
export function TournamentChip({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn(BASE, "border-border bg-secondary/60 text-muted-foreground", className)}>{children}</span>;
}
