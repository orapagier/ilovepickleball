import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { CalendarCheck, Clock, Mail, MapPin, Phone, Trophy, User, Wallet } from "lucide-react";
import { getSettings, getActiveCourts, getBusinessHours, getPriceTiers } from "@/lib/booking-data";
import { getSessionUser } from "@/lib/auth-helpers";
import { summarizeHours, closedWindowLabel } from "@/lib/hours-summary";
import { formatMoney, formatMinuteOfDay } from "@/lib/format";
import { minTierRateCents, groupTiersByWeekday } from "@/lib/pricing";

const HERO_IMAGE_PATH = path.join(process.cwd(), "public", "hero-court.jpg");

export default async function Home() {
  const [settings, courts, hours, tiers, user] = await Promise.all([
    getSettings(),
    getActiveCourts(),
    getBusinessHours(),
    getPriceTiers(),
    getSessionUser(),
  ]);
  const hourLines = summarizeHours(hours);
  const closedLabel = closedWindowLabel(hours);
  const hasHeroImage = fs.existsSync(HERO_IMAGE_PATH);
  const startingRateCents = minTierRateCents(tiers, settings.priceCentsPerHour);
  const rateGroups = groupTiersByWeekday(tiers);

  return (
    <div className="flex flex-1 flex-col bg-background">
      <section className="court-panel relative overflow-hidden">
        {hasHeroImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src="/hero-court.jpg"
            alt="Pickleball court at Smash Zone Tagum"
            className="absolute inset-0 size-full object-cover opacity-30"
          />
        )}
        <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-20 md:grid-cols-[1.15fr_0.85fr] md:py-28">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-navy-foreground/70">
              Tagum City · Davao del Norte
            </p>
            <h1 className="mt-4 text-4xl font-bold leading-[1.05] md:text-6xl">{settings.businessName}</h1>
            <p className="mt-5 max-w-lg text-base text-navy-foreground/80 md:text-lg">
              Book your court. Bring your paddle.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href={user ? "/book" : "/signin"}
                className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90"
              >
                <CalendarCheck className="size-4" />
                {user ? "Book a court" : "Sign in to book"}
              </Link>
              <a
                href="#details"
                className="inline-flex items-center gap-2 rounded-full bg-navy-foreground/10 px-6 py-3 text-sm font-semibold text-navy-foreground transition-colors hover:bg-navy-foreground/20"
              >
                View rates &amp; hours
              </a>
            </div>
          </div>

          <div className="rounded-2xl border border-navy-foreground/15 bg-navy-foreground/10 p-6 backdrop-blur">
            <p className="text-xs font-semibold uppercase tracking-widest text-navy-foreground/70">Court rate</p>
            <p className="mt-2 text-4xl font-bold md:text-5xl">
              Starts at {formatMoney(startingRateCents, settings.currency)}
              <span className="text-lg font-medium text-navy-foreground/70"> /Hour</span>
            </p>
            <dl className="mt-6 space-y-3 text-sm">
              <div className="flex items-center justify-between gap-4 border-t border-navy-foreground/15 pt-3">
                <dt className="text-navy-foreground/70">Courts available</dt>
                <dd className="font-semibold">{courts.length}</dd>
              </div>
              <div className="flex items-center justify-between gap-4 border-t border-navy-foreground/15 pt-3">
                <dt className="text-navy-foreground/70">Slot length</dt>
                <dd className="font-semibold">{settings.slotDurationMin} min</dd>
              </div>
              <div className="flex items-center justify-between gap-4 border-t border-navy-foreground/15 pt-3">
                <dt className="text-navy-foreground/70">Minimum notice</dt>
                <dd className="font-semibold">{settings.leadMinutes} min</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <section id="details" className="mx-auto max-w-6xl px-4 py-16">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <article className="surface-card p-6">
            <Clock className="size-5 text-primary" />
            <h2 className="mt-4 text-lg font-semibold">Opening hours</h2>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              {hourLines.length > 0 ? (
                hourLines.map((line) => <li key={line}>{line}</li>)
              ) : (
                <li>Hours not set yet.</li>
              )}
            </ul>
          </article>

          <article className="surface-card p-6">
            <Trophy className="size-5 text-primary" />
            <h2 className="mt-4 text-lg font-semibold">Weekly rest day</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {closedLabel ? `Closed ${closedLabel}` : "Open every hour, every day."}
            </p>
            {closedLabel && <p className="mt-2 text-sm text-muted-foreground">Closed for Sabbath rest.</p>}
          </article>

          <article className="surface-card p-6">
            <MapPin className="size-5 text-primary" />
            <h2 className="mt-4 text-lg font-semibold">Where to find us</h2>
            <p className="mt-2 text-sm text-muted-foreground">{settings.address || "Tagum City, Davao del Norte"}</p>
          </article>
        </div>

        {/* Full width, not a peer of the short cards above — the daily bands are far
            wordier than any of them and a one-quarter column left it lopsided. */}
        <article className="mt-6 surface-card p-6">
          <div className="flex items-center gap-2">
            <Wallet className="size-5 text-primary" />
            <h2 className="text-lg font-semibold">Court rates</h2>
          </div>
          {rateGroups.length > 0 ? (
            <>
              <div className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
                {rateGroups.map((group) => (
                  <div key={group.label}>
                    <p className="text-xs font-semibold uppercase tracking-wide text-foreground">{group.label}</p>
                    <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
                      {group.tiers.map((t) => (
                        <li key={`${t.startMin}-${t.endMin}`}>
                          {formatMinuteOfDay(t.startMin)}–{formatMinuteOfDay(t.endMin)}:{" "}
                          {formatMoney(t.priceCentsPerHour, settings.currency)}/hr
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              {/* A day-specific band overrides the every-day one, so say which wins
                  rather than leaving two rates for the same hour unexplained. */}
              {rateGroups.length > 1 && (
                <p className="mt-5 text-xs text-muted-foreground">
                  A day’s own rate applies instead of the every-day rate.
                </p>
              )}
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              {formatMoney(settings.priceCentsPerHour, settings.currency)}/hr flat rate, every day
            </p>
          )}
        </article>

        <div className="mt-6 surface-card p-6">
          <h2 className="text-lg font-semibold">Contact</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <p className="flex items-center gap-2 text-sm">
              <User className="size-4 text-primary" />
              {settings.contactPerson || "—"}
            </p>
            <p className="flex items-center gap-2 text-sm">
              <Phone className="size-4 text-primary" />
              {settings.contactPhone || "—"}
            </p>
            <p className="flex items-center gap-2 text-sm">
              <Mail className="size-4 text-primary" />
              {settings.contactEmail || "—"}
            </p>
          </div>
        </div>
      </section>

      <footer className="border-t border-border py-8">
        <div className="mx-auto max-w-6xl px-4 text-sm text-muted-foreground">
          © {new Date().getFullYear()} {settings.businessName}
        </div>
      </footer>
    </div>
  );
}
