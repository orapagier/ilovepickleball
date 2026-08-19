import Link from "next/link";
import { DateTime } from "luxon";
import { prisma } from "@/lib/prisma";
import { getSettings, getActiveCourts, getPriceTiers } from "@/lib/booking-data";
import { formatMoney } from "@/lib/format";
import { computeBookingPriceCents } from "@/lib/pricing";
import { PAY_METHOD_LABELS } from "@/lib/pay-method";
import { cn } from "@/lib/utils";
import { ActionButton } from "@/components/action-button";
import { RescheduleControl } from "@/components/admin/reschedule-control";
import { ExportLink } from "@/components/admin/export-link";
import { adminCancelBooking, adminDeleteBooking } from "@/lib/actions/admin-actions";
import { BOOKING_STATUS_LABELS, bookingStatusLabel } from "@/lib/booking-status";

const EDITABLE_STATUSES = ["pending_payment", "awaiting_confirmation", "awaiting_call", "confirmed"];

const FILTERS = ["all", ...Object.keys(BOOKING_STATUS_LABELS)];

export default async function AdminBookingsPage(props: PageProps<"/admin/bookings">) {
  const searchParams = await props.searchParams;
  const status = typeof searchParams.status === "string" ? searchParams.status : "all";

  const [bookings, settings, courts, tiers] = await Promise.all([
    prisma.booking.findMany({
      where: status === "all" ? {} : { status: status as never },
      include: { court: true, customer: true, payment: true },
      orderBy: { startUtc: "desc" },
      take: 200,
    }),
    getSettings(),
    getActiveCourts(),
    getPriceTiers(),
  ]);
  const todayISO = DateTime.now().setZone(settings.timezone).toFormat("yyyy-LL-dd");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-end gap-3">
        {/* Carries the status filter so the file matches the chips above it.
            It is not capped at the 200 rows shown here — an export is for the
            spreadsheet, where the whole history is the point. */}
        <ExportLink href={`/api/admin/export/bookings.csv${status === "all" ? "" : `?status=${status}`}`}>
          Export CSV
        </ExportLink>
      </div>

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
            {f === "all" ? "All" : BOOKING_STATUS_LABELS[f as keyof typeof BOOKING_STATUS_LABELS]}
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
          const editable = EDITABLE_STATUSES.includes(b.status);
          const totalCents = computeBookingPriceCents({
            startMs: b.startUtc.getTime(),
            hours: b.hours,
            slotDurationMin: settings.slotDurationMin,
            tz: settings.timezone,
            tiers,
            fallbackCentsPerHour: settings.priceCentsPerHour,
          });
          return (
            <li key={b.id} className="surface-card flex flex-wrap items-start justify-between gap-3 p-3">
              {/* `min-w-0` + `break-words`: an email is one unbreakable token
                  wider than a phone, and a flex item won't shrink below it. */}
              <div className="min-w-0">
                <p className="font-medium">
                  {b.court.name} — {dateLabel} ({b.hours}h)
                </p>
                <p className="break-words text-sm text-muted-foreground">
                  {b.customer.name || b.customer.email} · {formatMoney(totalCents, settings.currency)} ·{" "}
                  {bookingStatusLabel(b)}
                  {b.payMethod ? ` · ${PAY_METHOD_LABELS[b.payMethod] ?? b.payMethod}` : ""}
                </p>
                {editable && (
                  <RescheduleControl
                    bookingId={b.id}
                    courts={courts}
                    currentCourtId={b.courtId}
                    todayISO={todayISO}
                  />
                )}
              </div>
              <div className="flex shrink-0 flex-wrap items-start gap-2">
                {editable && (
                  <ActionButton
                    action={adminCancelBooking.bind(null, b.id)}
                    confirmMessage="Cancel this booking?"
                    className="btn btn-danger btn-sm"
                  >
                    Cancel
                  </ActionButton>
                )}
                <ActionButton
                  action={adminDeleteBooking.bind(null, b.id)}
                  confirmMessage={
                    editable
                      ? `Permanently delete this ${bookingStatusLabel(b).toLowerCase()} booking for ${
                          b.customer.name || b.customer.email
                        }? The slot is freed and the customer is not notified. This cannot be undone.`
                      : "Permanently delete this booking and its payment record? This cannot be undone."
                  }
                  className="btn btn-danger btn-sm"
                >
                  Delete
                </ActionButton>
              </div>
            </li>
          );
        })}
        {bookings.length === 0 && <p className="text-sm text-muted-foreground">No bookings found.</p>}
      </ul>
    </div>
  );
}
