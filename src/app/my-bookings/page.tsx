import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth-helpers";
import { getSettings } from "@/lib/booking-data";
import { reapExpiredBookings } from "@/lib/expiry";
import { formatMoney } from "@/lib/format";
import { CancelButton } from "@/components/booking/cancel-button";
import { cn } from "@/lib/utils";

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
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-3xl font-bold">My bookings</h1>
        <Link
          href="/book"
          className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90"
        >
          Book another court
        </Link>
      </div>

      {bookings.length === 0 ? (
        <p className="surface-card p-8 text-center text-sm text-muted-foreground">
          No bookings yet. Reserve your first court slot to see it here.
        </p>
      ) : (
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
              <li key={b.id} className="surface-card flex flex-wrap items-center gap-4 p-5">
                <div className="min-w-48 grow">
                  <p className="font-semibold">
                    {b.court.name} — {dateLabel}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {b.hours}h · {formatMoney(settings.priceCentsPerHour * b.hours, settings.currency)}
                  </p>
                </div>

                <span
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium",
                    b.status === "cancelled" || b.status === "expired"
                      ? "bg-destructive/10 text-destructive"
                      : b.status === "confirmed"
                        ? "bg-success/10 text-success"
                        : "bg-secondary text-secondary-foreground",
                  )}
                >
                  {STATUS_LABELS[b.status] ?? b.status}
                </span>

                <Link href={`/book/${b.id}`} className="text-sm font-medium text-primary hover:underline">
                  View
                </Link>

                {CANCELLABLE.includes(b.status) && <CancelButton bookingId={b.id} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
