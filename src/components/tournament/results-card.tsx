import { Award, Medal, Radio, Trophy } from "lucide-react";
import type { MatchBracket, TournamentFormat } from "@/generated/prisma/enums";
import { formatMoney } from "@/lib/format";
import {
  finalPlacements,
  placeLabel,
  PODIUM_PLACES,
  resolveFormatConfig,
  withPrizes,
  type PrizeRow,
} from "@/lib/tournament";
import { entryName } from "@/lib/tournament-data";
import type { StandingsEntry, StandingsMatch } from "@/components/tournament/standings-table";
import { cn } from "@/lib/utils";

/**
 * What a tournament's draw amounts to, said briefly: one line for the browse
 * grid, the winners card for the tournament's own page, and the prize list for
 * one that hasn't been played yet.
 *
 * They are built out of the same `finalPlacements` the detail page reads, so
 * the glance and the page can never disagree.
 */

/** The tournament columns these cards read. Structural so both the browse
 *  query and the detail query satisfy it without a conversion step. */
export type ResultsCardTournament = {
  format: TournamentFormat;
  currency: string;
  poolCount: number | null;
  advancePerPool: number | null;
  swissRounds: number | null;
};

/** A match as these cards need it: everything a standings table reads, plus
 *  where it sits in the draw and which court it is on. */
export type ResultsCardMatch = StandingsMatch & {
  round: number;
  bracket: MatchBracket | null;
  courtId: number | null;
  court: { name: string } | null;
};

type CardProps = {
  tournament: ResultsCardTournament;
  registrations: StandingsEntry[];
  matches: ResultsCardMatch[];
  /** `"embedded"` drops the card's own border, shadow and padding, for when it
   *  sits inside `TournamentCard`'s footer band — a bordered box nested one pixel
   *  inside another bordered box is the thing that made the browse page look
   *  cluttered. `"card"` (the default) is the standalone treatment the
   *  tournament's own page uses. */
  variant?: "card" | "embedded";
};

/** The outer shell of a results card, in whichever of the two forms is asked for. */
function shellClass(variant: CardProps["variant"], className?: string): string {
  return cn("flex flex-col gap-3", variant === "embedded" ? null : "surface-card p-4", className);
}

/** The small uppercase heading these cards label their sections with. One
 *  definition so the browse page doesn't mix 10px and 11px versions of it. */
const EYEBROW = "text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground";

/** Entries that are actually in the draw — the field every card is about. */
function drawnEntries(registrations: StandingsEntry[]): StandingsEntry[] {
  return registrations.filter((r) => r.status !== "withdrawn" && r.status !== "waitlisted");
}

/* ------------------------------------------------------------------ *
 * One line
 * ------------------------------------------------------------------ */

/**
 * A tournament's result as a single line, for the browse grid: who is on court
 * while it is being played, who won once it is over.
 *
 * The tables, the pools and the bracket stay on the tournament's own page. A
 * card in a grid is a glance, and a five-row table folded inside one is what
 * made that grid unreadable — every card a different height, none of them
 * lining up with its neighbour.
 *
 * It reads the draw rather than the tournament's status, so it cannot disagree
 * with the matches it is given: something on court means live, nothing left
 * undecided means finished.
 */
export function ResultsLine({ tournament, registrations, matches }: CardProps) {
  const inDraw = drawnEntries(registrations);
  if (inDraw.length === 0 || matches.length === 0) return null;

  const nameById = new Map(inDraw.map((r) => [r.id, entryName(r)]));
  const name = (id: string | null) => (id && nameById.get(id)) || "—";

  const onCourt = matches.filter((m) => m.status === "in_progress");
  if (onCourt.length > 0) {
    const [match, ...rest] = onCourt;
    return (
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
        <Radio className="size-3.5 shrink-0 text-success" />
        <span className="font-semibold text-success">
          {name(match.sideARegistrationId)} vs {name(match.sideBRegistrationId)}
        </span>
        <span className="text-muted-foreground">
          {match.court?.name ?? "Court to be called"}
          {rest.length > 0 && ` · +${rest.length} more on court`}
        </span>
      </p>
    );
  }

  const decided = matches.filter((m) => m.status === "completed" || m.status === "walkover").length;
  if (decided < matches.length) {
    return (
      <p className="text-xs text-muted-foreground">
        <span className="data-value text-foreground">
          {decided} of {matches.length}
        </span>{" "}
        matches decided · next match to be called
      </p>
    );
  }

  const config = resolveFormatConfig(tournament.format, inDraw.length, tournament);
  const champion = finalPlacements(tournament.format, config, registrations, matches).find((p) => p.place === 1);
  if (!champion) return null;

  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
      <Trophy className="size-3.5 shrink-0 text-primary" />
      <span className="text-muted-foreground">Winner</span>
      <span className="font-semibold">
        {name(champion.registrationId)}
        {champion.tied && " (tied)"}
      </span>
    </p>
  );
}

/* ------------------------------------------------------------------ *
 * Finished
 * ------------------------------------------------------------------ */

/** Champion, runner-up, third — loudest first, so the card has a shape before
 *  any of the words are read. */
const PODIUM_TONE = [
  { icon: Trophy, className: "border-primary/30 bg-primary/10 text-primary" },
  { icon: Medal, className: "border-border bg-secondary text-foreground" },
  { icon: Award, className: "border-border bg-secondary/60 text-muted-foreground" },
];

/**
 * Who won, and what they won.
 *
 * The placings come from the draw through `finalPlacements` and the prizes from
 * the tournament's own prize table, paired by place — so a tournament that pays
 * three deep shows three, one that pays two shows two, and a tie for third shows
 * both entries against the one third-place prize rather than picking one of them
 * to hand it to.
 */
export function WinnersCard({
  tournament,
  registrations,
  matches,
  prizes,
  className,
  variant,
}: CardProps & { prizes: PrizeRow[]; className?: string }) {
  const inDraw = drawnEntries(registrations);
  if (inDraw.length === 0) return null;

  const config = resolveFormatConfig(tournament.format, inDraw.length, tournament);
  const placements = finalPlacements(tournament.format, config, registrations, matches);
  const podium = withPrizes(placements, prizes).filter((p) => p.place <= PODIUM_PLACES);
  if (podium.length === 0) return null;

  const nameById = new Map(inDraw.map((r) => [r.id, entryName(r)]));

  return (
    <div className={shellClass(variant, className)}>
      <p className={EYEBROW}>Winners</p>
      <ul className="flex flex-col gap-2">
        {podium.map((p) => {
          const tone = PODIUM_TONE[Math.min(p.place, PODIUM_TONE.length) - 1];
          const Icon = tone.icon;
          return (
            <li key={p.registrationId} className="flex items-start gap-2.5">
              <span
                className={cn(
                  "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border",
                  tone.className,
                )}
              >
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-semibold">{nameById.get(p.registrationId) ?? "—"}</span>
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {p.prize?.label ?? placeLabel(p.place)}
                    {p.tied && " (tied)"}
                  </span>
                </p>
                {p.prize && (p.prize.amountCents != null || p.prize.description) && (
                  <p className="text-xs text-muted-foreground">
                    {p.prize.amountCents != null && (
                      <span className="font-semibold text-foreground">
                        {formatMoney(p.prize.amountCents, tournament.currency)}
                      </span>
                    )}
                    {p.prize.amountCents != null && p.prize.description && " · "}
                    {p.prize.description}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The prize list on its own, for a tournament that hasn't been played yet.
 *
 * Before there is anybody to attach them to, the prizes are the advertisement —
 * which is exactly when a member is deciding whether the entry fee is worth it.
 */
export function PrizeList({
  prizes,
  currency,
  className,
}: {
  prizes: PrizeRow[];
  currency: string;
  className?: string;
}) {
  if (prizes.length === 0) return null;

  return (
    <ul className={cn("flex flex-col gap-2", className)}>
      {prizes.map((p) => (
        <li key={p.place} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
          <span className="font-medium">{p.label || placeLabel(p.place)}</span>
          <span className="text-muted-foreground">
            {p.amountCents != null && (
              <span className="font-semibold text-foreground">{formatMoney(p.amountCents, currency)}</span>
            )}
            {p.amountCents != null && p.description && " · "}
            {p.description}
          </span>
        </li>
      ))}
    </ul>
  );
}
