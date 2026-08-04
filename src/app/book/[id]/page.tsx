import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth-helpers";
import { getSettings } from "@/lib/booking-data";
import { reapExpiredBookings } from "@/lib/expiry";
import { formatMoney } from "@/lib/format";
import { Countdown } from "@/components/booking/countdown";
import { PaymentPanel } from "@/components/booking/payment-panel";
import { CancelButton } from "@/components/booking/cancel-button";

export default async function BookingDetailPage(props: PageProps<"/book/[id]">) {
  const { id } = await props.params;
  const user = await getSessionUser();
  if (!user) redirect("/api/auth/signin");

  await reapExpiredBookings();

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { court: true, payment: true },
  });
  if (!booking || booking.customerId !== user.id) notFound();

  const settings = await getSettings();
  const totalCents = settings.priceCentsPerHour * booking.hours;

  const dateLabel = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: settings.timezone,
  }).format(booking.startUtc);

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
          Booking #{booking.id.slice(-6).toUpperCase()}
        </h1>
        <p className="text-zinc-600 dark:text-zinc-300">
          {booking.court.name} — {dateLabel} ({booking.hours}h)
        </p>
        <p className="font-medium text-zinc-700 dark:text-zinc-200">
          Total: {formatMoney(totalCents, settings.currency)}
        </p>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        {booking.status === "pending_payment" && (
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="mb-1 font-semibold text-zinc-900 dark:text-zinc-50">Pay via GCash</h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-300">
                Send {formatMoney(totalCents, settings.currency)} to:
              </p>
              <p className="text-sm text-zinc-800 dark:text-zinc-100">
                <strong>{settings.gcashName || "(GCash name not set)"}</strong> —{" "}
                {settings.gcashNumber || "(GCash number not set)"}
              </p>
            </div>
            {booking.expiresAt && <Countdown expiresAtMs={booking.expiresAt.getTime()} />}
            <PaymentPanel bookingId={booking.id} />
          </div>
        )}

        {booking.status === "awaiting_confirmation" && (
          <div className="flex flex-col gap-2">
            <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">Verifying your payment</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              We received your GCash reference{" "}
              <strong>{booking.payment?.referenceNumber ?? ""}</strong> and are checking it. You&apos;ll see this
              update to confirmed once verified — no need to do anything else.
            </p>
          </div>
        )}

        {booking.status === "awaiting_call" && (
          <div className="flex flex-col gap-3">
            <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">Call to arrange payment</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              Multi-hour bookings are arranged by phone. Please call{" "}
              <strong>{settings.contactPerson || "us"}</strong> at{" "}
              <strong>{settings.contactPhone || "(phone number not set)"}</strong> within{" "}
              {settings.holdMinutes} minutes, or this reservation will be released automatically.
            </p>
            {booking.expiresAt && <Countdown expiresAtMs={booking.expiresAt.getTime()} />}
          </div>
        )}

        {booking.status === "confirmed" && (
          <div className="flex flex-col gap-2">
            <h2 className="font-semibold text-emerald-700 dark:text-emerald-400">Booking confirmed</h2>
            {booking.payMethod === "gcash" && (
              <p className="text-sm text-zinc-600 dark:text-zinc-300">Payment verified via GCash. See you on court!</p>
            )}
            {booking.payMethod === "cash_onsite" && (
              <p className="text-sm text-zinc-600 dark:text-zinc-300">
                Please pay {formatMoney(totalCents, settings.currency)} in cash when you arrive.
              </p>
            )}
            {booking.payMethod === "arranged" && (
              <p className="text-sm text-zinc-600 dark:text-zinc-300">Payment arranged by phone. See you on court!</p>
            )}
          </div>
        )}

        {booking.status === "cancelled" && (
          <p className="text-sm text-zinc-600 dark:text-zinc-300">This booking was cancelled.</p>
        )}

        {booking.status === "expired" && (
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
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
