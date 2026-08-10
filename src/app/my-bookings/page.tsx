import Link from "next/link";
import { redirect } from "next/navigation";
import { UserRound } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth-helpers";
import { getSettings, getPriceTiers } from "@/lib/booking-data";
import { reapExpiredBookings } from "@/lib/expiry";
import { formatMoney } from "@/lib/format";
import { computeBookingPriceCents } from "@/lib/pricing";
import { CancelButton } from "@/components/booking/cancel-button";
import { ActionButton } from "@/components/action-button";
import { adminCancelBooking } from "@/lib/actions/admin-actions";
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

function statusLabel(b: { status: string; payment: { status: string } | null }): string {
  if (b.status === "pending_payment" && b.payment?.status === "rejected") return "Fix reference number";
  return STATUS_LABELS[b.status] ?? b.status;
}

export default async function MyBookingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/signin?callbackUrl=/my-bookings");

  await reapExpiredBookings();

  /* An admin gets every customer's bookings here, each labelled with who holds
     the slot; everyone else sees only their own. The customer relation is
     always loaded but only rendered for an admin — for a customer it is just
     themselves, so there is nothing to disclose either way. */
  const isAdmin = user.role === "admin";

  const [bookings, settings, tiers] = await Promise.all([
    prisma.booking.findMany({
      where: isAdmin ? {} : { customerId: user.id },
      include: { court: true, payment: true, customer: true },
      orderBy: { startUtc: "desc" },
      take: isAdmin ? 200 : undefined,
    }),
    getSettings(),
    getPriceTiers(),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold">{isAdmin ? "All bookings" : "My bookings"}</h1>
          {isAdmin && (
            <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
              Admin view — every customer
            </span>
          )}
        </div>
        <Link
          href="/book"
          className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90"
        >
          Book another court
        </Link>
      </div>

      {bookings.length === 0 ? (
        <p className="surface-card p-8 text-center text-sm text-muted-foreground">
          {isAdmin
            ? "No bookings yet."
            : "No bookings yet. Reserve your first court slot to see it here."}
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
            const totalCents = computeBookingPriceCents({
              startMs: b.startUtc.getTime(),
              hours: b.hours,
              slotDurationMin: settings.slotDurationMin,
              tz: settings.timezone,
              tiers,
              fallbackCentsPerHour: settings.priceCentsPerHour,
            });

            /* Only the booking's owner gets the detail link and the customer
               cancel action — both are owner-gated server-side, so offering
               them to an admin on someone else's row would just error. */
            const own = b.customerId === user.id;

            return (
              <li key={b.id} className="surface-card flex flex-wrap items-center gap-4 p-5">
                <div className="min-w-48 grow">
                  <p className="font-semibold">
                    {b.court.name} — {dateLabel}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {b.hours}h · {formatMoney(totalCents, settings.currency)}
                  </p>
                  {isAdmin && (
                    <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                      <UserRound className="size-4 shrink-0 text-primary" />
                      <span className="font-medium">{b.customer.name || "Unnamed"}</span>
                      {b.customer.phone && <span className="text-muted-foreground">{b.customer.phone}</span>}
                      <span className="text-muted-foreground">{b.customer.email}</span>
                      <Link
                        href={`/admin/users/${b.customerId}`}
                        className="font-medium text-primary hover:underline"
                      >
                        Records
                      </Link>
                    </p>
                  )}
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
                  {statusLabel(b)}
                </span>

                {own && (
                  <Link href={`/book/${b.id}`} className="text-sm font-medium text-primary hover:underline">
                    View
                  </Link>
                )}

                {CANCELLABLE.includes(b.status) &&
                  (own ? (
                    <CancelButton bookingId={b.id} />
                  ) : (
                    <ActionButton
                      action={adminCancelBooking.bind(null, b.id)}
                      confirmMessage="Cancel this customer's booking?"
                      className="shrink-0 rounded-full border border-destructive/30 px-3 py-1.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
                    >
                      Cancel
                    </ActionButton>
                  ))}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
