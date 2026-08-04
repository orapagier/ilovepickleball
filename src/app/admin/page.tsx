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
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Pending actions</h1>
      {bookings.length === 0 && (
        <p className="text-zinc-600 dark:text-zinc-300">Nothing needs your attention right now.</p>
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
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-zinc-900 dark:text-zinc-50">
                    {b.court.name} — {dateLabel} ({b.hours}h)
                  </p>
                  <p className="text-sm text-zinc-600 dark:text-zinc-300">
                    {b.customer.name || b.customer.email} ·{" "}
                    {formatMoney(settings.priceCentsPerHour * b.hours, settings.currency)}
                  </p>
                  {b.customerNote && (
                    <p className="text-sm italic text-zinc-500 dark:text-zinc-400">&ldquo;{b.customerNote}&rdquo;</p>
                  )}
                </div>
                <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium whitespace-nowrap text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                  {b.status === "awaiting_confirmation" ? "GCash submitted" : "Awaiting call"}
                </span>
              </div>

              {b.status === "awaiting_confirmation" && (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <p className="text-sm text-zinc-700 dark:text-zinc-200">
                    Ref: <strong>{b.payment?.referenceNumber}</strong>
                  </p>
                  <ActionButton
                    action={() => verifyBooking(b.id)}
                    className="rounded-full bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
                  >
                    Verify
                  </ActionButton>
                  <RejectForm bookingId={b.id} />
                </div>
              )}

              {b.status === "awaiting_call" && (
                <div className="mt-3 flex flex-wrap gap-3">
                  <ActionButton
                    action={() => confirmCallBooking(b.id)}
                    className="rounded-full bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
                  >
                    Confirm call received
                  </ActionButton>
                  <ActionButton
                    action={() => adminCancelBooking(b.id)}
                    confirmMessage="Cancel this booking?"
                    className="rounded-full border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
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
