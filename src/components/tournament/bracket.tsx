import type { MatchBracket } from "@/generated/prisma/enums";
import { entryName, type TournamentMatch } from "@/lib/tournament-data";
import { cn } from "@/lib/utils";
import { MatchStatusBadge } from "@/components/tournament/status-badge";

/** Rounds are named from the end backwards, which is how players talk about
 *  them — the last round is the final whether the draw has 4 entries or 32. */
export function roundLabel(round: number, totalRounds: number): string {
  const fromEnd = totalRounds - round;
  if (fromEnd === 0) return "Final";
  if (fromEnd === 1) return "Semifinals";
  if (fromEnd === 2) return "Quarterfinals";
  return `Round ${round}`;
}

/**
 * The same idea inside a two-bracket draw, where "the final" is ambiguous: the
 * winners bracket ends in the winners final, the losers bracket in the losers
 * final, and neither of them decides the tournament.
 */
function bracketRoundLabel(bracket: MatchBracket | null, index: number, total: number): string {
  if (bracket === "grand_final") return "Grand final";
  if (bracket === "grand_final_reset") return "Reset";
  if (bracket === "winners") return index === total ? "Winners final" : roundLabel(index, total + 1);
  if (bracket === "losers") return index === total ? "Losers final" : `Losers round ${index}`;
  return roundLabel(index, total);
}

function sideLabel(side: TournamentMatch["sideA"]): string {
  return side ? entryName(side) : "—";
}

/**
 * A round-by-round elimination bracket. Columns scroll sideways rather than
 * shrinking, because a name squeezed to three characters tells nobody who is
 * playing; the card clips the overflow so the page itself never widens.
 *
 * A double-elimination draw is drawn as two brackets stacked, because that is
 * what it is — the losers bracket runs alongside the winners bracket rather
 * than after it, and interleaving them into one row of columns makes the path
 * through the draw impossible to follow.
 */
export function Bracket({ matches }: { matches: TournamentMatch[] }) {
  if (matches.length === 0) return null;

  const sections: MatchBracket[] = ["winners", "losers"];
  const twoBracket = matches.some((m) => m.bracket != null);
  if (!twoBracket) return <BracketColumns matches={matches} bracket={null} />;

  const finals = matches
    .filter((m) => m.bracket === "grand_final" || m.bracket === "grand_final_reset")
    // A reset that was never needed is a formality the engine records, not a
    // match anybody played. Showing it would put a phantom walkover between the
    // grand final and the champion.
    .filter((m) => m.bracket !== "grand_final_reset" || wasPlayed(m));

  return (
    <div className="flex flex-col gap-4">
      {sections.map((bracket) => {
        const inBracket = matches.filter((m) => m.bracket === bracket);
        if (inBracket.length === 0) return null;
        return (
          <section key={bracket} className="flex flex-col gap-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {bracket === "winners" ? "Winners bracket" : "Losers bracket"}
            </h3>
            <BracketColumns matches={inBracket} bracket={bracket} />
          </section>
        );
      })}

      {finals.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Grand final
          </h3>
          <BracketColumns matches={finals} bracket="grand_final" perMatchLabel />
          <p className="text-xs text-muted-foreground">
            The winners-bracket champion arrives unbeaten, so they are twice to beat — losing the grand final only
            levels it at one loss each, and the reset decides the title.
          </p>
        </section>
      )}
    </div>
  );
}

/** Whether a match was actually contested, as opposed to resolved on paper. */
function wasPlayed(match: TournamentMatch): boolean {
  return match.sideARegistrationId != null && match.sideBRegistrationId != null;
}

function BracketColumns({
  matches,
  bracket,
  perMatchLabel,
}: {
  matches: TournamentMatch[];
  bracket: MatchBracket | null;
  /** Label each column by its own match rather than by round — the grand final
   *  and its reset are one round apart but read as a single sequence. */
  perMatchLabel?: boolean;
}) {
  // Rounds are numbered across the whole draw, so a bracket's own columns are
  // its distinct rounds in order rather than 1..n.
  const rounds = [...new Set(matches.map((m) => m.round))].sort((a, b) => a - b);

  return (
    <div className="surface-card overflow-x-auto">
      <div className="flex min-w-max gap-4 p-4 sm:gap-6 sm:p-5">
        {rounds.map((round, i) => {
          const inRound = matches
            .filter((m) => m.round === round)
            .sort((a, b) => a.matchNumber - b.matchNumber);
          return (
            <div key={round} className="flex min-w-56 flex-1 flex-col gap-3">
              <h4 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground sm:text-xs">
                {perMatchLabel
                  ? bracketRoundLabel(inRound[0]?.bracket ?? bracket, i + 1, rounds.length)
                  : bracketRoundLabel(bracket, i + 1, rounds.length)}
              </h4>
              {/* Later rounds hold fewer matches, so they centre against the
                  round that feeds them instead of stacking at the top. */}
              <div className="flex flex-1 flex-col justify-around gap-3">
                {inRound.map((match) => (
                  <BracketMatch key={match.id} match={match} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BracketMatch({ match }: { match: TournamentMatch }) {
  const decided = match.status === "completed" || match.status === "walkover";

  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Match {match.matchNumber}
        </span>
        <MatchStatusBadge status={match.status} />
      </div>

      <BracketSide
        name={sideLabel(match.sideA)}
        won={decided && match.winnerRegistrationId != null && match.winnerRegistrationId === match.sideARegistrationId}
      />
      <BracketSide
        name={sideLabel(match.sideB)}
        won={decided && match.winnerRegistrationId != null && match.winnerRegistrationId === match.sideBRegistrationId}
      />

      <p className="mt-2 text-xs text-muted-foreground">
        {match.status === "walkover"
          ? "Walkover"
          : match.score
            ? match.score
            : match.court
              ? `On ${match.court.name}`
              : "Not started"}
      </p>
    </div>
  );
}

function BracketSide({ name, won }: { name: string; won: boolean }) {
  return (
    <p
      className={cn(
        "truncate border-l-2 py-0.5 pl-2 text-sm",
        won ? "border-primary font-bold text-foreground" : "border-transparent text-muted-foreground",
      )}
    >
      {name}
    </p>
  );
}
