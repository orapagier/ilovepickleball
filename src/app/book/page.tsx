import { DateTime } from "luxon";
import { getActiveCourts, getSettings } from "@/lib/booking-data";
import { getSessionUser } from "@/lib/auth-helpers";
import { BookingFlow } from "@/components/booking/booking-flow";

export default async function BookPage() {
  const [courts, settings, user] = await Promise.all([getActiveCourts(), getSettings(), getSessionUser()]);
  const todayISO = DateTime.now().setZone(settings.timezone).toFormat("yyyy-LL-dd");

  return (
    <div className="flex flex-1 flex-col">
      <h1 className="mx-auto w-full max-w-2xl px-4 pt-8 text-2xl font-bold text-zinc-900 dark:text-zinc-50">
        Book a court
      </h1>
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
