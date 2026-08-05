import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth-helpers";
import { getSettings, getPriceTiers } from "@/lib/booking-data";
import { reapExpiredBookings } from "@/lib/expiry";
import { formatMoney } from "@/lib/format";
import { computeBookingPriceCents } from "@/lib/pricing";
import { PAY_METHOD_LABELS } from "@/lib/pay-method";
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
  const totalCents = computeBookingPriceCents({
    startMs: booking.startUtc.getTime(),
    hours: booking.hours,
    slotDurationMin: settings.slotDurationMin,
    tz: settings.timezone,
    tiers,
    fallbackCentsPerHour: settings.priceCentsPerHour,
  });

  const dateLabel = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: settings.timezone,
  }).format(booking.startUtc);

  const payMethodLabel = booking.payMethod ? (PAY_METHOD_LABELS[booking.payMethod] ?? booking.payMethod) : "";

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-bold">Booking #{booking.id.slice(-6).toUpperCase()}</h1>
        <p className="text-muted-foreground">
          {booking.court.name} — {dateLabel} ({booking.hours}h)
        </p>
        <p className="font-medium">Total: {formatMoney(totalCents, settings.currency)}</p>
      </div>

      <div className="surface-card p-5">
        {booking.status === "pending_payment" && (
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="mb-1 font-semibold">Pay to reserve</h2>
              <p className="text-sm text-muted-foreground">
                Send {formatMoney(totalCents, settings.currency)}, then submit your reference number below.
              </p>
            </div>
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
          <p className="text-sm text-muted-foreground">This booking was cancelled.</p>
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
