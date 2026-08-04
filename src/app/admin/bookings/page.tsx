import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/booking-data";
import { formatMoney } from "@/lib/format";

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
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">All bookings</h1>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={f === "all" ? "/admin/bookings" : `/admin/bookings?status=${f}`}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              status === f
                ? "bg-emerald-600 text-white"
                : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200"
            }`}
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
            <li
              key={b.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div>
                <p className="font-medium text-zinc-900 dark:text-zinc-50">
                  {b.court.name} — {dateLabel} ({b.hours}h)
                </p>
                <p className="text-sm text-zinc-600 dark:text-zinc-300">
                  {b.customer.name || b.customer.email} ·{" "}
                  {formatMoney(settings.priceCentsPerHour * b.hours, settings.currency)} ·{" "}
                  {STATUS_LABELS[b.status] ?? b.status}
                  {b.payMethod ? ` · ${b.payMethod}` : ""}
                </p>
              </div>
            </li>
          );
        })}
        {bookings.length === 0 && <p className="text-sm text-zinc-500 dark:text-zinc-400">No bookings found.</p>}
      </ul>
    </div>
  );
}
