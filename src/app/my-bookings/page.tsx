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
import { Countdown } from "@/components/booking/countdown";
import { PaymentPanel } from "@/components/booking/payment-panel";
import { ActionButton } from "@/components/action-button";
import { adminCancelBooking } from "@/lib/actions/admin-actions";
import { resolveGroupAnchorId } from "@/lib/booking-group";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";

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

  const dateFmt = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: settings.timezone,
  });
  const priceOf = (b: { startUtc: Date; hours: number }) =>
    computeBookingPriceCents({
      startMs: b.startUtc.getTime(),
      hours: b.hours,
      slotDurationMin: settings.slotDurationMin,
      tz: settings.timezone,
      tiers,
      fallbackCentsPerHour: settings.priceCentsPerHour,
    });

  /* Bookings made in the same multi-slot checkout share a `groupId` anchor and
     pay with one reference number (see submitPayment) — so only the first
     pending one for a given anchor gets a payment panel; the rest just point
     back to it instead of repeating the same form. */
  const renderedPaymentAnchors = new Set<string>();

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        eyebrow={isAdmin ? "Admin view — every customer" : "Your court time"}
        title={isAdmin ? "All bookings" : "My bookings"}
        description={
          isAdmin
            ? "Every customer's bookings, newest first. Cancel on their behalf from any row."
            : "Everything you've reserved, newest first. Pay for anything still pending before its timer runs out."
        }
        action={
          <Link href="/book" className="btn btn-primary">
            Book another court
          </Link>
        }
      />

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-7 sm:py-9">

      {bookings.length === 0 ? (
        <p className="surface-card p-8 text-center text-sm text-muted-foreground">
          {isAdmin
            ? "No bookings yet."
            : "No bookings yet. Reserve your first court slot to see it here."}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {bookings.map((b) => {
            const dateLabel = dateFmt.format(b.startUtc);
            const totalCents = priceOf(b);

            /* Only the booking's owner gets the detail link and the customer
               cancel action — both are owner-gated server-side, so offering
               them to an admin on someone else's row would just error. */
            const own = b.customerId === user.id;

            const isPendingOwn = own && b.status === "pending_payment";
            const anchorId = resolveGroupAnchorId(b);
            const groupPendingSiblings = isPendingOwn
              ? bookings.filter(
                  (x) =>
                    x.id !== b.id &&
                    x.customerId === b.customerId &&
                    x.status === "pending_payment" &&
                    resolveGroupAnchorId(x) === anchorId,
                )
              : [];
            const alreadyShownForGroup = isPendingOwn && renderedPaymentAnchors.has(anchorId);
            const showPaymentHere = isPendingOwn && !alreadyShownForGroup;
            if (showPaymentHere) renderedPaymentAnchors.add(anchorId);
            const groupTotalCents = totalCents + groupPendingSiblings.reduce((sum, x) => sum + priceOf(x), 0);

            return (
              <li key={b.id} className="surface-card flex flex-col gap-4 p-5">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="min-w-48 grow">
                    <p className="font-bold">
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
                      "rounded-full px-2.5 py-1 text-[0.6875rem] font-bold uppercase tracking-[0.1em]",
                      b.status === "cancelled" || b.status === "expired"
                        ? "bg-destructive/12 text-destructive"
                        : b.status === "confirmed"
                          ? "bg-success/12 text-success"
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
                        className="btn btn-danger btn-sm shrink-0"
                      >
                        Cancel
                      </ActionButton>
                    ))}
                </div>

                {/* A freshly created booking lands here directly whenever a multi-slot
                    pick splits into several bookings, so the payment step has to live
                    on this row rather than only on the single-booking detail page. When
                    several of those share one checkout group, only the first renders the
                    form — one reference number pays for all of them (see submitPayment) —
                    and the rest just point back to it. */}
                {showPaymentHere && (
                  <div className="flex flex-col gap-3 border-t border-border pt-4">
                    {b.payment?.status === "rejected" ? (
                      <div>
                        <h3 className="mb-1 text-sm font-semibold text-destructive">Fix your reference number</h3>
                        <p className="text-sm text-muted-foreground">
                          We couldn&apos;t verify the reference number you submitted
                          {b.payment.rejectReason ? `: ${b.payment.rejectReason}` : "."} Double-check it and resubmit
                          before the timer runs out, or this booking will be cancelled automatically.
                        </p>
                      </div>
                    ) : (
                      <div>
                        <h3 className="mb-1 text-sm font-semibold">Pay to reserve</h3>
                        <p className="text-sm text-muted-foreground">
                          {groupPendingSiblings.length > 0
                            ? `You picked ${groupPendingSiblings.length + 1} bookings in one go, so one reference number covers all of them — send ${formatMoney(groupTotalCents, settings.currency)} total, then submit it below.`
                            : `Send ${formatMoney(totalCents, settings.currency)}, then submit your reference number below.`}
                        </p>
                      </div>
                    )}

                    {groupPendingSiblings.length > 0 && (
                      <div className="rounded-2xl bg-secondary/60 p-3.5">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          This payment covers
                        </p>
                        <ul className="mt-2 space-y-1.5 text-sm">
                          <li className="flex items-center justify-between gap-3">
                            <span className="truncate">
                              {b.court.name} — {dateLabel}
                            </span>
                            <span className="shrink-0 font-medium">{formatMoney(totalCents, settings.currency)}</span>
                          </li>
                          {groupPendingSiblings.map((x) => (
                            <li key={x.id} className="flex items-center justify-between gap-3">
                              <span className="truncate">
                                {x.court.name} — {dateFmt.format(x.startUtc)}
                              </span>
                              <span className="shrink-0 font-medium">{formatMoney(priceOf(x), settings.currency)}</span>
                            </li>
                          ))}
                        </ul>
                        <p className="mt-2.5 flex items-center justify-between gap-3 border-t border-border pt-2.5 text-sm font-semibold">
                          <span>Total</span>
                          <span>{formatMoney(groupTotalCents, settings.currency)}</span>
                        </p>
                      </div>
                    )}

                    {b.expiresAt && <Countdown expiresAtMs={b.expiresAt.getTime()} />}
                    <PaymentPanel
                      bookingId={b.id}
                      accounts={{
                        gcash: { name: settings.gcashName, number: settings.gcashNumber },
                        bdo: { name: settings.bdoAccountName, number: settings.bdoAccountNumber },
                        qrph: { name: settings.qrphAccountName, number: settings.qrphAccountNumber },
                      }}
                    />
                  </div>
                )}

                {isPendingOwn && alreadyShownForGroup && (
                  <p className="border-t border-border pt-4 text-sm text-muted-foreground">
                    Included in the payment for one of your other bookings above — pay once to cover this one too.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      </div>
    </div>
  );
}
