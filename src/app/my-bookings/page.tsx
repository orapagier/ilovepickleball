import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth-helpers";
import { getSettings } from "@/lib/booking-data";
import { reapExpiredBookings } from "@/lib/expiry";
import { formatMoney } from "@/lib/format";
import { CancelButton } from "@/components/booking/cancel-button";

const STATUS_LABELS: Record<string, string> = {
  pending_payment: "Pending payment",
  awaiting_confirmation: "Verifying payment",
  awaiting_call: "Awaiting your call",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
  expired: "Expired",
};

const CANCELLABLE = ["pending_payment", "awaiting_confirmation", "awaiting_call", "confirmed"];

export default async function MyBookingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/api/auth/signin");

  await reapExpiredBookings();

  const [bookings, settings] = await Promise.all([
    prisma.booking.findMany({
      where: { customerId: user.id },
      include: { court: true },
      orderBy: { startUtc: "desc" },
    }),
    getSettings(),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-8">
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">My bookings</h1>

      {bookings.length === 0 && (
        <p className="text-zinc-600 dark:text-zinc-300">
          No bookings yet.{" "}
          <Link href="/book" className="text-emerald-700 underline dark:text-emerald-400">
            Book a court
          </Link>
          .
        </p>
      )}

      <ul className="flex flex-col gap-3">
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
              className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-zinc-900 dark:text-zinc-50">
                    {b.court.name} — {dateLabel}
                  </p>
                  <p className="text-sm text-zinc-600 dark:text-zinc-300">
                    {b.hours}h · {formatMoney(settings.priceCentsPerHour * b.hours, settings.currency)} ·{" "}
                    {STATUS_LABELS[b.status] ?? b.status}
                  </p>
                </div>
                <Link
                  href={`/book/${b.id}`}
                  className="text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400"
                >
                  View
                </Link>
              </div>
              {CANCELLABLE.includes(b.status) && (
                <div className="mt-2">
                  <CancelButton bookingId={b.id} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
