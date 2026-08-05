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
import { adminCancelBooking, adminDeleteBooking } from "@/lib/actions/admin-actions";

const STATUS_LABELS: Record<string, string> = {
  pending_payment: "Pending payment",
  awaiting_confirmation: "Verifying payment",
  awaiting_call: "Awaiting call",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
  expired: "Expired",
};

const EDITABLE_STATUSES = ["pending_payment", "awaiting_confirmation", "awaiting_call", "confirmed"];
const DELETABLE_STATUSES = ["cancelled", "expired"];
const DELETE_AFTER_DAYS = 30;

const FILTERS = ["all", ...Object.keys(STATUS_LABELS)];

function statusLabel(b: { status: string; payment: { status: string } | null }): string {
  if (b.status === "pending_payment" && b.payment?.status === "rejected") return "Fixing reference number";
  return STATUS_LABELS[b.status] ?? b.status;
}

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
  // Server Component: runs once per request, not subject to client re-render purity concerns.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const todayISO = DateTime.now().setZone(settings.timezone).toFormat("yyyy-LL-dd");

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
          const editable = EDITABLE_STATUSES.includes(b.status);
          const deletable =
            DELETABLE_STATUSES.includes(b.status) &&
            nowMs - b.updatedAt.getTime() > DELETE_AFTER_DAYS * 24 * 60 * 60 * 1000;
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
              <div>
                <p className="font-medium">
                  {b.court.name} — {dateLabel} ({b.hours}h)
                </p>
                <p className="text-sm text-muted-foreground">
                  {b.customer.name || b.customer.email} · {formatMoney(totalCents, settings.currency)} ·{" "}
                  {statusLabel(b)}
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
              {editable && (
                <ActionButton
                  action={adminCancelBooking.bind(null, b.id)}
                  confirmMessage="Cancel this booking?"
                  className="shrink-0 rounded-full border border-destructive/30 px-3 py-1.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
                >
                  Cancel
                </ActionButton>
              )}
              {deletable && (
                <ActionButton
                  action={adminDeleteBooking.bind(null, b.id)}
                  confirmMessage="Permanently delete this booking? This cannot be undone."
                  className="shrink-0 rounded-full border border-destructive/30 px-3 py-1.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
                >
                  Delete
                </ActionButton>
              )}
            </li>
          );
        })}
        {bookings.length === 0 && <p className="text-sm text-muted-foreground">No bookings found.</p>}
      </ul>
    </div>
  );
}
