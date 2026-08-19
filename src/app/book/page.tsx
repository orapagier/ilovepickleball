import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { DateTime } from "luxon";
import { getActiveCourts, getSettings, getBusinessHours, getPriceTiers } from "@/lib/booking-data";
import { getSessionUser, getProfileCompletion } from "@/lib/auth-helpers";
import { splitMoney } from "@/lib/format";
import { minTierRateCents } from "@/lib/pricing";
import { closedWindowLabel, isSabbathNow } from "@/lib/hours-summary";
import { MAX_ADVANCE_DAYS } from "@/lib/scheduling";
import { BookingFlow } from "@/components/booking/booking-flow";
import { PageHeader } from "@/components/page-header";

export default async function BookPage(props: PageProps<"/book">) {
  const searchParams = await props.searchParams;
  const [courts, settings, hours, tiers, user] = await Promise.all([
    getActiveCourts(),
    getSettings(),
    getBusinessHours(),
    getPriceTiers(),
    getSessionUser(),
  ]);
  const todayISO = DateTime.now().setZone(settings.timezone).toFormat("yyyy-LL-dd");
  const maxISO = DateTime.now().setZone(settings.timezone).plus({ days: MAX_ADVANCE_DAYS }).toFormat("yyyy-LL-dd");
  const needsRegistration = user ? !(await getProfileCompletion(user.id)).complete : false;

  /* The homepage card picks a day and an hour and hands them over here, so the
     grid opens where the visitor left off with their hour already ticked. Both
     are validated rather than trusted: an out-of-range date would render a grid
     the server would refuse to book. */
  const wantDate = typeof searchParams.date === "string" ? searchParams.date : undefined;
  const initialDate = wantDate && wantDate >= todayISO && wantDate <= maxISO ? wantDate : undefined;
  const wantStart = typeof searchParams.start === "string" ? Number(searchParams.start) : NaN;
  const initialStart = Number.isSafeInteger(wantStart) ? wantStart : undefined;
  const wantCourt = typeof searchParams.court === "string" ? Number(searchParams.court) : NaN;
  const initialCourt = courts.some((c) => c.id === wantCourt) ? wantCourt : undefined;
  const closedLabel = closedWindowLabel(hours);
  const startingRate = splitMoney(minTierRateCents(tiers, settings.priceCentsPerHour), settings.currency);

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title="Book a court"
        description={
          /* The three facts that price the decision, before the grid below asks
             for one. Set for the dusk band, not the page. */
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="figure-display text-lg text-dusk-foreground">
              {startingRate.symbol}
              {startingRate.amount}
            </span>
            <span>and up per hour</span>
            <span aria-hidden className="text-dusk-foreground/30">|</span>
            <span className="data-value text-dusk-foreground">{courts.length}</span>
            <span>{courts.length === 1 ? "court" : "courts"}</span>
            <span aria-hidden className="text-dusk-foreground/30">|</span>
            <span className="data-value text-dusk-foreground">{settings.slotDurationMin}</span>
            <span>min slots</span>
          </span>
        }
        action={
          user && (
            <Link href="/my-bookings" className="btn btn-on-dusk">
              My bookings
            </Link>
          )
        }
      >
        <p className="flex max-w-xl items-start gap-2.5 rounded-2xl bg-white/10 px-4 py-3.5 text-xs leading-relaxed text-dusk-foreground/85 sm:text-sm">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" />
          <span>
            Pay instantly via GCash, BDO or QRPh — or for bookings of 4 hours or more, call us to arrange
            payment. Your slot is held for {settings.holdMinutes} minutes.
          </span>
        </p>
      </PageHeader>
      <BookingFlow
        courts={courts}
        todayISO={todayISO}
        maxISO={maxISO}
        currency={settings.currency}
        priceCentsPerHour={settings.priceCentsPerHour}
        slotDurationMin={settings.slotDurationMin}
        tz={settings.timezone}
        tiers={tiers}
        holdMinutes={settings.holdMinutes}
        signedIn={!!user}
        needsRegistration={needsRegistration}
        closedLabel={closedLabel}
        inSabbath={isSabbathNow(settings.timezone)}
        initialDate={initialDate}
        initialStart={initialStart}
        initialCourt={initialCourt}
      />
    </div>
  );
}
