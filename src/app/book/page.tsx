import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { DateTime } from "luxon";
import { getActiveCourts, getSettings, getBusinessHours, getPriceTiers } from "@/lib/booking-data";
import { getSessionUser } from "@/lib/auth-helpers";
import { formatMoney } from "@/lib/format";
import { minTierRateCents } from "@/lib/pricing";
import { closedWindowLabel } from "@/lib/hours-summary";
import { BookingFlow } from "@/components/booking/booking-flow";

export default async function BookPage() {
  const [courts, settings, hours, tiers, user] = await Promise.all([
    getActiveCourts(),
    getSettings(),
    getBusinessHours(),
    getPriceTiers(),
    getSessionUser(),
  ]);
  const todayISO = DateTime.now().setZone(settings.timezone).toFormat("yyyy-LL-dd");
  const closedLabel = closedWindowLabel(hours);
  const startingRateCents = minTierRateCents(tiers, settings.priceCentsPerHour);

  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-end justify-between gap-4 px-4 pt-8">
        <div>
          <h1 className="text-3xl font-bold">Book a court</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Starts at {formatMoney(startingRateCents, settings.currency)} /hour · {courts.length} courts ·{" "}
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
      <div className="mx-auto flex w-full max-w-6xl items-start gap-2 px-4 pt-4 text-sm text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
        <p>
          Pay instantly via GCash, BDO, or QRPh/InstaPay — or for bookings of 4 hours or more, call us to arrange
          payment. Your slot is held for {settings.holdMinutes} minutes.
        </p>
      </div>
      <BookingFlow
        courts={courts}
        todayISO={todayISO}
        currency={settings.currency}
        priceCentsPerHour={settings.priceCentsPerHour}
        slotDurationMin={settings.slotDurationMin}
        tz={settings.timezone}
        tiers={tiers}
        holdMinutes={settings.holdMinutes}
        signedIn={!!user}
        closedLabel={closedLabel}
      />
    </div>
  );
}
