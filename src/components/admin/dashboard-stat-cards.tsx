import { CalendarCheck, CalendarRange, Percent, Wallet } from "lucide-react";
import { StatCard } from "@/components/admin/stat-card";
import { formatMoney } from "@/lib/format";
import type { DashboardStats } from "@/lib/analytics";

export function DashboardStatCards({ stats, currency }: { stats: DashboardStats; currency: string }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        icon={CalendarCheck}
        label="Today's Bookings"
        tag="today"
        value={String(stats.todayBookings)}
        caption="Confirmed today"
        tint="primary"
      />
      <StatCard
        icon={CalendarRange}
        label="Period Bookings"
        tag={stats.periodLabel}
        value={String(stats.periodBookings)}
        caption="vs last period"
        trendPct={stats.periodBookingsPctChange}
        tint="success"
      />
      <StatCard
        icon={Wallet}
        label="Net Revenue"
        tag="after fees"
        value={formatMoney(stats.netRevenueCents, currency)}
        caption="vs last period"
        trendPct={stats.netRevenuePctChange}
        tint="warning"
      />
      <StatCard
        icon={Percent}
        label="Court Utilization"
        tag="booked"
        value={`${Math.round(stats.courtUtilizationPct)}%`}
        caption="Available hours booked"
        tint="accent"
      />
    </div>
  );
}
