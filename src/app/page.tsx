import Link from "next/link";
import { getSettings, getActiveCourts, getBusinessHours } from "@/lib/booking-data";
import { summarizeHours } from "@/lib/hours-summary";
import { formatMoney } from "@/lib/format";

export default async function Home() {
  const [settings, courts, hours] = await Promise.all([
    getSettings(),
    getActiveCourts(),
    getBusinessHours(),
  ]);
  const hourLines = summarizeHours(hours);

  return (
    <div className="flex flex-1 flex-col items-center bg-gradient-to-b from-emerald-50 to-zinc-50 dark:from-zinc-900 dark:to-zinc-950">
      <section className="flex w-full max-w-4xl flex-col items-center gap-6 px-4 py-20 text-center">
        <h1 className="text-4xl font-extrabold tracking-tight text-zinc-900 sm:text-5xl dark:text-zinc-50">
          {settings.businessName}
        </h1>
        <p className="max-w-xl text-lg text-zinc-600 dark:text-zinc-300">
          Reserve your pickleball court online in minutes — {courts.length} court
          {courts.length === 1 ? "" : "s"} available, {formatMoney(settings.priceCentsPerHour, settings.currency)}{" "}
          per hour.
        </p>
        <Link
          href="/book"
          className="rounded-full bg-emerald-600 px-8 py-3 text-lg font-semibold text-white shadow transition-colors hover:bg-emerald-700"
        >
          Book Now
        </Link>
      </section>

      <section className="grid w-full max-w-4xl gap-6 px-4 pb-20 sm:grid-cols-2">
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-3 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Hours</h2>
          <ul className="space-y-1 text-sm text-zinc-600 dark:text-zinc-300">
            {hourLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
            Closed Friday sunset – Saturday sunset for Sabbath.
          </p>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-3 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Contact</h2>
          <dl className="space-y-1 text-sm text-zinc-600 dark:text-zinc-300">
            {settings.contactPerson && (
              <div>
                <dt className="inline font-medium">Contact: </dt>
                <dd className="inline">{settings.contactPerson}</dd>
              </div>
            )}
            {settings.contactPhone && (
              <div>
                <dt className="inline font-medium">Phone: </dt>
                <dd className="inline">{settings.contactPhone}</dd>
              </div>
            )}
            {settings.address && (
              <div>
                <dt className="inline font-medium">Address: </dt>
                <dd className="inline">{settings.address}</dd>
              </div>
            )}
            {!settings.contactPerson && !settings.contactPhone && !settings.address && (
              <p className="text-zinc-400">Contact details coming soon.</p>
            )}
          </dl>
        </div>
      </section>
    </div>
  );
}
