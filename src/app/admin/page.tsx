import { getSettings } from "@/lib/booking-data";
import { getDashboardStats } from "@/lib/analytics";
import { DashboardStatCards } from "@/components/admin/dashboard-stat-cards";
import { RevenueAnalyticsCard } from "@/components/admin/revenue-analytics-card";

export default async function AdminDashboardPage() {
  const [settings, stats] = await Promise.all([getSettings(), getDashboardStats()]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-bold">Dashboard</h1>
      <DashboardStatCards stats={stats} currency={settings.currency} />
      <RevenueAnalyticsCard stats={stats} currency={settings.currency} />
    </div>
  );
}
