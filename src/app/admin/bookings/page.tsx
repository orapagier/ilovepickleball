import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/booking-data";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<string, string> = {
  pending_payment: "Pending payment",
  awaiting_confirmation: "Verifying payment",
  awaiting_call: "Awaiting call",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
  expired: "Expired",
};

const FILTERS = ["all", ...Object.keys(STATUS_LABELS)];

export default async function AdminBookingsPage(props: PageProps<"/admin/bookings">) {
  const searchParams = await props.searchParams;
  const status = typeof searchParams.status === "string" ? searchParams.status : "all";

  const [bookings, settings] = await Promise.all([
    prisma.booking.findMany({
      where: status === "all" ? {} : { status: status as never },
      include: { court: true, customer: true },
      orderBy: { startUtc: "desc" },
      take: 200,
    }),
    getSettings(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-bold">All bookings</h1>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={f === "all" ? "/admin/bookings" : `/admin/bookings?status=${f}`}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-colors",
              status === f
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-accent",
            )}
          >
            {f === "all" ? "All" : STATUS_LABELS[f]}
          </Link>
        ))}
      </div>

      <ul className="flex flex-col gap-2">
        {bookings.map((b) => {
          const dateLabel = new Intl.DateTimeFormat("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            timeZone: settings.timezone,
          }).format(b.startUtc);
          return (
            <li key={b.id} className="surface-card flex items-center justify-between gap-3 p-3">
              <div>
                <p className="font-medium">
                  {b.court.name} — {dateLabel} ({b.hours}h)
                </p>
                <p className="text-sm text-muted-foreground">
                  {b.customer.name || b.customer.email} ·{" "}
                  {formatMoney(settings.priceCentsPerHour * b.hours, settings.currency)} ·{" "}
                  {STATUS_LABELS[b.status] ?? b.status}
                  {b.payMethod ? ` · ${b.payMethod}` : ""}
                </p>
              </div>
            </li>
          );
        })}
        {bookings.length === 0 && <p className="text-sm text-muted-foreground">No bookings found.</p>}
      </ul>
    </div>
  );
}
