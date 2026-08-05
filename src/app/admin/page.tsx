import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/booking-data";
import { reapExpiredBookings } from "@/lib/expiry";
import { formatMoney } from "@/lib/format";
import { verifyBooking, confirmCallBooking, adminCancelBooking } from "@/lib/actions/admin-actions";
import { ActionButton } from "@/components/action-button";
import { RejectForm } from "@/components/admin/reject-form";

export default async function AdminQueuePage() {
  await reapExpiredBookings();

  const [bookings, settings] = await Promise.all([
    prisma.booking.findMany({
      where: { status: { in: ["awaiting_confirmation", "awaiting_call"] } },
      include: { court: true, customer: true, payment: true },
      orderBy: { startUtc: "asc" },
    }),
    getSettings(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-bold">Pending actions</h1>
      {bookings.length === 0 && (
        <p className="surface-card p-8 text-center text-sm text-muted-foreground">
          Nothing needs your attention right now.
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
            <li key={b.id} className="surface-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">
                    {b.court.name} — {dateLabel} ({b.hours}h)
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {b.customer.name || b.customer.email} ·{" "}
                    {formatMoney(settings.priceCentsPerHour * b.hours, settings.currency)}
                  </p>
                  {b.customerNote && (
                    <p className="text-sm italic text-muted-foreground">&ldquo;{b.customerNote}&rdquo;</p>
                  )}
                </div>
                <span className="rounded-full bg-warning/15 px-3 py-1 text-xs font-medium whitespace-nowrap text-warning">
                  {b.status === "awaiting_confirmation" ? "GCash submitted" : "Awaiting call"}
                </span>
              </div>

              {b.status === "awaiting_confirmation" && (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <p className="text-sm">
                    Ref: <strong>{b.payment?.referenceNumber}</strong>
                  </p>
                  <ActionButton
                    action={verifyBooking.bind(null, b.id)}
                    className="rounded-full bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
                  >
                    Verify
                  </ActionButton>
                  <RejectForm bookingId={b.id} />
                </div>
              )}

              {b.status === "awaiting_call" && (
                <div className="mt-3 flex flex-wrap gap-3">
                  <ActionButton
                    action={confirmCallBooking.bind(null, b.id)}
                    className="rounded-full bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
                  >
                    Confirm call received
                  </ActionButton>
                  <ActionButton
                    action={adminCancelBooking.bind(null, b.id)}
                    confirmMessage="Cancel this booking?"
                    className="rounded-full border border-destructive/30 px-3 py-1.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
                  >
                    Cancel
                  </ActionButton>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
