import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { CalendarCheck, Clock, Mail, MapPin, Phone, Trophy, User } from "lucide-react";
import { getSettings, getActiveCourts, getBusinessHours } from "@/lib/booking-data";
import { getSessionUser } from "@/lib/auth-helpers";
import { summarizeHours, closedWindowLabel } from "@/lib/hours-summary";
import { formatMoney } from "@/lib/format";

const HERO_IMAGE_PATH = path.join(process.cwd(), "public", "hero-court.jpg");

export default async function Home() {
  const [settings, courts, hours, user] = await Promise.all([
    getSettings(),
    getActiveCourts(),
    getBusinessHours(),
    getSessionUser(),
  ]);
  const hourLines = summarizeHours(hours);
  const closedLabel = closedWindowLabel(hours);
  const hasHeroImage = fs.existsSync(HERO_IMAGE_PATH);

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
            <p className="mt-2 text-5xl font-bold">
              {formatMoney(settings.priceCentsPerHour, settings.currency)}
              <span className="text-lg font-medium text-navy-foreground/70"> / hour</span>
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
        <div className="grid gap-6 md:grid-cols-3">
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
