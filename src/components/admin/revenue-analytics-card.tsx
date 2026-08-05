import { CircleDollarSign } from "lucide-react";
import { formatMoney } from "@/lib/format";
import type { DashboardStats } from "@/lib/analytics";

function RevenueChart({ daily, avgPerDay }: { daily: DashboardStats["dailyRevenue"]; avgPerDay: number }) {
  const width = 600;
  const height = 180;
  const pad = 8;
  const max = Math.max(...daily.map((d) => d.cents), avgPerDay, 1);
  const barWidth = (width - pad * 2) / daily.length;
  const scaleY = (v: number) => height - pad - (v / max) * (height - pad * 2);
  const avgY = scaleY(avgPerDay);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-44 w-full" preserveAspectRatio="none" role="img" aria-label="Daily revenue this period">
      {daily.map((d) => {
        const x = pad + (d.day - 1) * barWidth;
        const y = scaleY(d.cents);
        return (
          <rect
            key={d.day}
            x={x + barWidth * 0.15}
            y={y}
            width={Math.max(barWidth * 0.7, 1)}
            height={Math.max(height - pad - y, 0)}
            rx={2}
            className="fill-success/70"
          />
        );
      })}
      <line x1={pad} x2={width - pad} y1={avgY} y2={avgY} className="stroke-primary" strokeWidth={2} strokeDasharray="6 4" />
    </svg>
  );
}

export function RevenueAnalyticsCard({ stats, currency }: { stats: DashboardStats; currency: string }) {
  const hasRevenue = stats.netRevenueCents > 0;

  return (
    <div className="surface-card flex flex-col gap-4 p-5">
      <div>
        <h2 className="font-display text-lg font-bold">Revenue Analytics</h2>
        <p className="text-sm text-muted-foreground">Earnings overview &amp; projections</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-success/10 p-4 text-center">
          <p className="text-2xl font-bold text-success">{formatMoney(stats.netRevenueCents, currency)}</p>
          <p className="mt-1 text-xs font-medium text-success/80">Net Club Revenue (this period)</p>
        </div>
        <div className="rounded-xl bg-primary/10 p-4 text-center">
          <p className="text-2xl font-bold text-primary">{stats.periodBookings}</p>
          <p className="mt-1 text-xs font-medium text-primary/80">Total Bookings</p>
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-success" /> Actual
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-primary" /> Avg Projected
        </span>
      </div>

      {hasRevenue ? (
        <RevenueChart daily={stats.dailyRevenue} avgPerDay={stats.avgProjectedCentsPerDay} />
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl bg-muted/40 py-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <CircleDollarSign className="size-6" />
          </span>
          <p className="text-sm font-semibold">No revenue yet</p>
          <p className="max-w-64 text-xs text-muted-foreground">Revenue data will appear once bookings are confirmed.</p>
        </div>
      )}
    </div>
  );
}
