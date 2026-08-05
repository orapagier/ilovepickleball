import Link from "next/link";
import { DateTime } from "luxon";
import { getActiveCourts, getSettings } from "@/lib/booking-data";
import { getSessionUser } from "@/lib/auth-helpers";
import { formatMoney } from "@/lib/format";
import { BookingFlow } from "@/components/booking/booking-flow";

export default async function BookPage() {
  const [courts, settings, user] = await Promise.all([getActiveCourts(), getSettings(), getSessionUser()]);
  const todayISO = DateTime.now().setZone(settings.timezone).toFormat("yyyy-LL-dd");

  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-2xl flex-wrap items-end justify-between gap-4 px-4 pt-8">
        <div>
          <h1 className="text-3xl font-bold">Book a court</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {formatMoney(settings.priceCentsPerHour, settings.currency)} per hour · {courts.length} courts ·{" "}
            {settings.slotDurationMin}-min slots
          </p>
        </div>
        {user && (
          <Link
            href="/my-bookings"
            className="rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            My bookings
          </Link>
        )}
      </div>
      <BookingFlow
        courts={courts}
        todayISO={todayISO}
        priceCentsPerHour={settings.priceCentsPerHour}
        currency={settings.currency}
        holdMinutes={settings.holdMinutes}
        signedIn={!!user}
      />
    </div>
  );
}
