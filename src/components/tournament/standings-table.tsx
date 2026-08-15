import { buildStandings } from "@/lib/tournament";
import { entryName, type TournamentEntry, type TournamentMatch } from "@/lib/tournament-data";
import { cn } from "@/lib/utils";

/**
 * Round-robin table: wins first, then point differential, per §5.5. Only
 * entries that are still in the draw appear — a withdrawal isn't a last place.
 */
export function StandingsTable({
  registrations,
  matches,
  qualifying = 0,
}: {
  registrations: TournamentEntry[];
  matches: TournamentMatch[];
  /** How many places from the top go through to a knockout. Rows above the line
   *  are marked, so a pool table says who is qualifying as well as who is
   *  winning. Zero means there is nothing to qualify for. */
  qualifying?: number;
}) {
  const inDraw = registrations.filter((r) => r.status !== "withdrawn" && r.status !== "waitlisted");
  const nameById = new Map(inDraw.map((r) => [r.id, entryName(r)]));
  const rows = buildStandings(
    inDraw.map((r) => r.id),
    matches,
  );

  return (
    <div className="surface-card overflow-x-auto">
      <table className="w-full min-w-max text-sm">
        <thead>
          <tr className="border-b border-border text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            <th className="px-3 py-3 text-left font-semibold sm:px-4">#</th>
            <th className="px-3 py-3 text-left font-semibold sm:px-4">Entry</th>
            <th className="px-3 py-3 text-right font-semibold sm:px-4">P</th>
            <th className="px-3 py-3 text-right font-semibold sm:px-4">W</th>
            <th className="px-3 py-3 text-right font-semibold sm:px-4">L</th>
            <th className="px-3 py-3 text-right font-semibold sm:px-4">Pts</th>
            <th className="px-3 py-3 text-right font-semibold sm:px-4">Diff</th>
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
              <td className="px-3 py-2.5 text-muted-foreground sm:px-4">{i + 1}</td>
              <td className="px-3 py-2.5 font-medium sm:px-4">{nameById.get(row.registrationId) ?? "—"}</td>
              <td className="px-3 py-2.5 text-right tabular-nums sm:px-4">{row.played}</td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums sm:px-4">{row.wins}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground sm:px-4">{row.losses}</td>
              <td className="px-3 py-2.5 text-right tabular-nums sm:px-4">{row.pointsFor}</td>
              <td className="px-3 py-2.5 text-right tabular-nums sm:px-4">
                {row.diff > 0 ? `+${row.diff}` : row.diff}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-border px-3 py-2.5 text-[11px] text-muted-foreground sm:px-4">
        Sorted by wins, then point difference. Walkovers count as a win but score no points.
        {qualifying > 0 && ` The top ${qualifying} go through to the knockout.`}
      </p>
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
}: {
  registrations: TournamentEntry[];
  matches: TournamentMatch[];
  advancePerPool: number;
}) {
  const pools = [...new Set(registrations.map((r) => r.pool).filter((p): p is number => p != null))].sort(
    (a, b) => a - b,
  );
  if (pools.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      {pools.map((pool) => (
        <section key={pool} className="flex flex-col gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Pool {pool}
          </h3>
          <StandingsTable
            registrations={registrations.filter((r) => r.pool === pool)}
            matches={matches.filter((m) => m.pool === pool)}
            qualifying={advancePerPool}
          />
        </section>
      ))}
    </div>
  );
}
