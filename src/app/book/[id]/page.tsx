import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth-helpers";
import { getSettings, getPriceTiers } from "@/lib/booking-data";
import { reapExpiredBookings } from "@/lib/expiry";
import { formatMoney } from "@/lib/format";
import { computeBookingPriceCents } from "@/lib/pricing";
import { PAY_METHOD_LABELS } from "@/lib/pay-method";
import { resolveGroupAnchorId } from "@/lib/booking-group";
import { Countdown } from "@/components/booking/countdown";
import { PaymentPanel } from "@/components/booking/payment-panel";
import { CancelButton } from "@/components/booking/cancel-button";

export default async function BookingDetailPage(props: PageProps<"/book/[id]">) {
  const { id } = await props.params;
  const user = await getSessionUser();
  if (!user) redirect(`/signin?callbackUrl=/book/${id}`);

  await reapExpiredBookings();

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { court: true, payment: true },
  });
  if (!booking || booking.customerId !== user.id) notFound();

  const [settings, tiers] = await Promise.all([getSettings(), getPriceTiers()]);
  const priceOf = (b: { startUtc: Date; hours: number }) =>
    computeBookingPriceCents({
      startMs: b.startUtc.getTime(),
      hours: b.hours,
      slotDurationMin: settings.slotDurationMin,
      tz: settings.timezone,
      tiers,
      fallbackCentsPerHour: settings.priceCentsPerHour,
    });
  const totalCents = priceOf(booking);

  /* When this booking was created alongside others in the same multi-slot
     checkout, one reference number pays for all of them (see submitPayment) —
     so the pay step here has to show the combined total and list what else
     it covers, not just this one court/time. */
  const anchorId = resolveGroupAnchorId(booking);
  const otherGroupBookings = await prisma.booking.findMany({
    where: { customerId: user.id, id: { not: booking.id }, OR: [{ id: anchorId }, { groupId: anchorId }] },
    include: { court: true },
    orderBy: { startUtc: "asc" },
  });
  const pendingSiblings = otherGroupBookings.filter((b) => b.status === "pending_payment");
  const groupTotalCents = totalCents + pendingSiblings.reduce((sum, b) => sum + priceOf(b), 0);

  const dateFmt = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: settings.timezone,
  });
  const dateLabel = dateFmt.format(booking.startUtc);

  const payMethodLabel = booking.payMethod ? (PAY_METHOD_LABELS[booking.payMethod] ?? booking.payMethod) : "";

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-7 sm:py-9">
      <Link
        href="/my-bookings"
        className="inline-flex w-fit items-center gap-1.5 text-sm font-bold text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        My bookings
      </Link>

      <div className="surface-raised p-5 sm:p-6">
        <h1 className="text-2xl">{booking.court.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {dateLabel} · {booking.hours}h · #{booking.id.slice(-6).toUpperCase()}
        </p>
        <p className="mt-4 flex items-baseline gap-2 border-t border-border pt-4">
          <span className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Total</span>
          <span className="figure-display text-3xl">{formatMoney(totalCents, settings.currency)}</span>
        </p>
      </div>

      <div className="surface-card p-5">
        {booking.status === "pending_payment" && (
          <div className="flex flex-col gap-4">
            {booking.payment?.status === "rejected" ? (
              <div>
                <h2 className="mb-1 font-semibold text-destructive">Fix your reference number</h2>
                <p className="text-sm text-muted-foreground">
                  We couldn&apos;t verify the reference number you submitted
                  {booking.payment.rejectReason ? `: ${booking.payment.rejectReason}` : "."} Double-check it and
                  resubmit before the timer runs out, or this booking will be cancelled automatically.
                </p>
              </div>
            ) : (
              <div>
                <h2 className="mb-1 font-semibold">Pay to reserve</h2>
                <p className="text-sm text-muted-foreground">
                  {pendingSiblings.length > 0
                    ? `You picked ${pendingSiblings.length + 1} bookings in one go, so one reference number covers all of them — send ${formatMoney(groupTotalCents, settings.currency)} total, then submit it below.`
                    : `Send ${formatMoney(totalCents, settings.currency)}, then submit your reference number below.`}
                </p>
              </div>
            )}

            {pendingSiblings.length > 0 && (
              <div className="rounded-2xl bg-secondary/60 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  This payment covers
                </p>
                <ul className="mt-2 space-y-1.5 text-sm">
                  <li className="flex items-center justify-between gap-3">
                    <span className="truncate">
                      {booking.court.name} — {dateLabel}
                    </span>
                    <span className="shrink-0 font-medium">{formatMoney(totalCents, settings.currency)}</span>
                  </li>
                  {pendingSiblings.map((b) => (
                    <li key={b.id} className="flex items-center justify-between gap-3">
                      <span className="truncate">
                        {b.court.name} — {dateFmt.format(b.startUtc)}
                      </span>
                      <span className="shrink-0 font-medium">{formatMoney(priceOf(b), settings.currency)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2.5 flex items-center justify-between gap-3 border-t border-border pt-2.5 text-sm font-semibold">
                  <span>Total</span>
                  <span>{formatMoney(groupTotalCents, settings.currency)}</span>
                </p>
              </div>
            )}

            {booking.expiresAt && <Countdown expiresAtMs={booking.expiresAt.getTime()} />}
            <PaymentPanel
              bookingId={booking.id}
              accounts={{
                gcash: { name: settings.gcashName, number: settings.gcashNumber },
                bdo: { name: settings.bdoAccountName, number: settings.bdoAccountNumber },
                qrph: { name: settings.qrphAccountName, number: settings.qrphAccountNumber },
              }}
            />
          </div>
        )}

        {booking.status === "awaiting_confirmation" && (
          <div className="flex flex-col gap-2">
            <h2 className="font-semibold">Verifying your payment</h2>
            <p className="text-sm text-muted-foreground">
              We received your {payMethodLabel} reference <strong>{booking.payment?.referenceNumber ?? ""}</strong>{" "}
              and are checking it. You&apos;ll see this update to confirmed once verified — no need to do anything
              else.
            </p>
          </div>
        )}

        {booking.status === "awaiting_call" && (
          <div className="flex flex-col gap-3">
            <h2 className="font-semibold">Call to arrange payment</h2>
            <p className="text-sm text-muted-foreground">
              Bookings of 4 hours or more are arranged by phone. Please call{" "}
              <strong>{settings.contactPerson || "us"}</strong> at{" "}
              <strong>{settings.contactPhone || "(phone number not set)"}</strong> within {settings.holdMinutes}{" "}
              minutes, or this reservation will be released automatically.
            </p>
            {booking.expiresAt && <Countdown expiresAtMs={booking.expiresAt.getTime()} />}
          </div>
        )}

        {booking.status === "confirmed" && (
          <div className="flex flex-col gap-2">
            <h2 className="font-semibold text-success">Booking confirmed</h2>
            {(booking.payMethod === "gcash" || booking.payMethod === "bdo" || booking.payMethod === "qrph") && (
              <p className="text-sm text-muted-foreground">Payment verified via {payMethodLabel}. See you on court!</p>
            )}
            {booking.payMethod === "cash_onsite" && (
              <p className="text-sm text-muted-foreground">
                Please pay {formatMoney(totalCents, settings.currency)} in cash when you arrive.
              </p>
            )}
            {booking.payMethod === "arranged" && (
              <p className="text-sm text-muted-foreground">Payment arranged by phone. See you on court!</p>
            )}
          </div>
        )}

        {booking.status === "cancelled" && (
          <p className="text-sm text-muted-foreground">
            {booking.payment?.status === "rejected"
              ? "This booking was cancelled automatically because the reference number wasn't corrected in time."
              : "This booking was cancelled."}
          </p>
        )}

        {booking.status === "expired" && (
          <p className="text-sm text-muted-foreground">
            This hold expired because no action was taken in time. Please book again.
          </p>
        )}
      </div>

      {["pending_payment", "awaiting_confirmation", "awaiting_call", "confirmed"].includes(booking.status) && (
        <CancelButton bookingId={booking.id} />
      )}
    </div>
  );
}
