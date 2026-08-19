import type { MatchStatus, RegistrationStatus } from "@/generated/prisma/enums";
import { buildStandings } from "@/lib/tournament";
import { entryName } from "@/lib/tournament-data";
import { cn } from "@/lib/utils";

/**
 * The entry columns a table needs, stated structurally rather than as the
 * tournament-detail row.
 *
 * The detail page loads entries with their players and emails; the browse page
 * loads a much thinner row for its standings cards. Both satisfy this, so one
 * table serves both — and the alternative, a second copy of the markup for the
 * lighter shape, is exactly how two tables end up sorting differently.
 */
export type StandingsEntry = {
  id: string;
  status: RegistrationStatus;
  pool: number | null;
  player1: { name: string };
  player2: { name: string } | null;
};

/** The match columns a table needs — the same ones `buildStandings` reads. */
export type StandingsMatch = {
  status: MatchStatus;
  score: string;
  pool: number | null;
  sideARegistrationId: string | null;
  sideBRegistrationId: string | null;
  winnerRegistrationId: string | null;
};

/**
 * Round-robin table: wins first, then point differential, per §5.5. Only
 * entries that are still in the draw appear — a withdrawal isn't a last place.
 *
 * The compact variant drops the columns that are derivable from the rest (played
 * is wins plus losses; points-for only matters as the last tiebreak) and is what
 * the browse page shows beside a live tournament. The full table stays on the
 * tournament's own page, where there is room to read it.
 */
export function StandingsTable({
  registrations,
  matches,
  qualifying = 0,
  compact = false,
  limit,
}: {
  registrations: StandingsEntry[];
  matches: StandingsMatch[];
  /** How many places from the top go through to a knockout. Rows above the line
   *  are marked, so a pool table says who is qualifying as well as who is
   *  winning. Zero means there is nothing to qualify for. */
  qualifying?: number;
  /** Fewer columns and tighter rows, for a card rather than a page. */
  compact?: boolean;
  /** Show only this many rows, with a line saying how many were left off. A
   *  standings card is a glance, not the table. */
  limit?: number;
}) {
  const inDraw = registrations.filter((r) => r.status !== "withdrawn" && r.status !== "waitlisted");
  const nameById = new Map(inDraw.map((r) => [r.id, entryName(r)]));
  const allRows = buildStandings(
    inDraw.map((r) => r.id),
    matches,
  );
  const rows = limit != null ? allRows.slice(0, limit) : allRows;
  const hidden = allRows.length - rows.length;

  const cell = compact ? "px-2.5 py-2 sm:px-3" : "px-3 py-2.5 sm:px-4";
  const head = compact ? "px-2.5 py-2 sm:px-3" : "px-3 py-3 sm:px-4";

  return (
    /* The scroller is the card, not the page: a long doubles pair name is wider
       than a phone and has to be allowed to be, without dragging the layout
       sideways with it. */
    <div className={cn("overflow-x-auto", compact ? "rounded-md border border-border" : "surface-card")}>
      <table className={cn("w-full min-w-max", compact ? "text-xs sm:text-sm" : "text-sm")}>
        <thead>
          <tr className="border-b border-border text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            <th className={cn(head, "text-left font-semibold")}>#</th>
            <th className={cn(head, "text-left font-semibold")}>Entry</th>
            {!compact && <th className={cn(head, "text-right font-semibold")}>P</th>}
            <th className={cn(head, "text-right font-semibold")}>W</th>
            <th className={cn(head, "text-right font-semibold")}>L</th>
            {!compact && <th className={cn(head, "text-right font-semibold")}>Pts</th>}
            <th className={cn(head, "text-right font-semibold")}>Diff</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row.registrationId}
              className={cn(
                "border-b border-border last:border-0",
                // The qualifying line, drawn where it actually falls.
                qualifying > 0 && i === qualifying - 1 && "border-b-2 border-primary/40",
              )}
            >
              <td className={cn(cell, "text-muted-foreground")}>{i + 1}</td>
              <td className={cn(cell, "font-medium")}>{nameById.get(row.registrationId) ?? "—"}</td>
              {!compact && <td className={cn(cell, "text-right tabular-nums")}>{row.played}</td>}
              <td className={cn(cell, "text-right font-semibold tabular-nums")}>{row.wins}</td>
              <td className={cn(cell, "text-right tabular-nums text-muted-foreground")}>{row.losses}</td>
              {!compact && <td className={cn(cell, "text-right tabular-nums")}>{row.pointsFor}</td>}
              <td className={cn(cell, "text-right tabular-nums")}>{row.diff > 0 ? `+${row.diff}` : row.diff}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {compact ? (
        hidden > 0 && (
          <p className="border-t border-border px-2.5 py-1.5 text-[11px] text-muted-foreground sm:px-3">
            + {hidden} more {hidden === 1 ? "entry" : "entries"}
          </p>
        )
      ) : (
        <p className="border-t border-border px-3 py-2.5 text-[11px] text-muted-foreground sm:px-4">
          Sorted by wins, then point difference. Walkovers count as a win but score no points.
          {qualifying > 0 && ` The top ${qualifying} go through to the knockout.`}
        </p>
      )}
    </div>
  );
}

/**
 * One table per pool. Pools are played side by side and read side by side —
 * a single table over the whole field would rank entries against opponents they
 * never met.
 */
export function PoolTables({
  registrations,
  matches,
  advancePerPool,
  compact = false,
}: {
  registrations: StandingsEntry[];
  matches: StandingsMatch[];
  advancePerPool: number;
  compact?: boolean;
}) {
  const pools = [...new Set(registrations.map((r) => r.pool).filter((p): p is number => p != null))].sort(
    (a, b) => a - b,
  );
  if (pools.length === 0) return null;

  return (
    <div className={cn("flex flex-col", compact ? "gap-2.5" : "gap-4")}>
      {pools.map((pool) => (
        <section key={pool} className="flex flex-col gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Pool {pool}
          </h3>
          <StandingsTable
            registrations={registrations.filter((r) => r.pool === pool)}
            matches={matches.filter((m) => m.pool === pool)}
            qualifying={advancePerPool}
            compact={compact}
          />
        </section>
      ))}
    </div>
  );
}
