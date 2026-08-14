import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import {
  ArrowRight,
  CalendarCheck,
  Clock,
  ExternalLink,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  Sparkles,
  Trophy,
  User,
  Wallet,
  Zap,
} from "lucide-react";
import { getSettings, getActiveCourts, getBusinessHours, getPriceTiers } from "@/lib/booking-data";
import { getSessionUser } from "@/lib/auth-helpers";
import { summarizeHours, closedWindowLabel } from "@/lib/hours-summary";
import { formatMoney, formatMinuteOfDay } from "@/lib/format";
import { minTierRateCents, groupTiersByWeekday } from "@/lib/pricing";

const HERO_IMAGE_PATH = path.join(process.cwd(), "public", "hero-court.jpg");

/* Both are the plain public Maps URL forms — a pin lookup and a directions
   request keyed on the address text. Neither needs an API key, so the map keeps
   working off whatever the admin types into Settings. */
function mapsSearchUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function mapsDirectionsUrl(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}

function mapsEmbedUrl(address: string): string {
  return `https://www.google.com/maps?q=${encodeURIComponent(address)}&output=embed`;
}

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
            className="absolute inset-0 size-full object-cover"
          />
        )}
        {/* Two stacked washes rather than one flat opacity on the photo itself:
            a left-to-right one keeps the headline legible over the brightest part
            of the sky, a bottom one settles the rate card onto solid ground. Both
            ride on the shared navy token so the same gradient composites over
            either the photo or the plain court-panel fallback. */}
        <div className="absolute inset-0 bg-gradient-to-r from-navy via-navy/85 to-navy/50" />
        <div className="absolute inset-0 bg-gradient-to-t from-navy/70 via-transparent to-transparent" />

        <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-20 md:grid-cols-[1.15fr_0.85fr] md:items-center md:py-28">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-navy-foreground/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-navy-foreground/80">
              <Sparkles className="size-3.5 text-primary" />
              Tagum City · Davao del Norte
            </p>
            <h1 className="mt-5 text-4xl font-bold leading-[1.05] md:text-6xl">{settings.businessName}</h1>
            <p className="mt-5 max-w-lg text-base text-navy-foreground/80 md:text-lg">
              Book your court. Bring your paddle.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href={user ? "/book" : "/signin"}
                className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-lift transition-colors hover:opacity-90"
              >
                <CalendarCheck className="size-4" />
                {user ? "Book a court" : "Sign in to book"}
              </Link>
              <a
                href="#details"
                className="inline-flex items-center gap-2 rounded-full border border-navy-foreground/25 bg-navy-foreground/10 px-6 py-3 text-sm font-semibold text-navy-foreground backdrop-blur transition-colors hover:bg-navy-foreground/20"
              >
                View rates &amp; hours
              </a>
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs font-medium text-navy-foreground/70">
              <span className="inline-flex items-center gap-1.5">
                <Zap className="size-3.5 text-primary" />
                Instant online hold
              </span>
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="size-3.5 text-primary" />
                GCash · BDO · QRPh
              </span>
            </div>
          </div>

          <div className="rounded-2xl border border-navy-foreground/15 bg-navy-foreground/10 p-6 shadow-lift backdrop-blur">
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

      {/* A tinted band breaks the hero's dark panel from the white content below
          with something other than a hard edge, and gives the value props their
          own visual beat before the longer location/contact section. */}
      <section className="border-b border-border bg-secondary/40">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 sm:grid-cols-3">
          {[
            {
              icon: Zap,
              title: "Instant confirmation",
              body: "Tick your slots, pay online, and your court is held the moment we get your reference number.",
            },
            {
              icon: Wallet,
              title: "Pay your way",
              body: "GCash, BDO, or QRPh/InstaPay online — or call ahead for cash on longer sessions.",
            },
            {
              icon: CalendarCheck,
              title: `${courts.length} ${courts.length === 1 ? "court" : "courts"}, ${settings.slotDurationMin}-min slots`,
              body: "Book by the hour, any hour we're open — solo, with friends, or for a full event.",
            },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title} className="flex items-start gap-3.5">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Icon className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="font-semibold">{title}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="details" className="border-t border-border bg-secondary/40 px-4 py-16">
        <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[1.15fr_0.85fr] lg:gap-10">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Plan your visit</p>
            <h2 className="mt-3 text-3xl font-bold leading-[1.05] md:text-4xl">Hours, rest day &amp; rates</h2>

            <div className="mt-8 grid gap-6 sm:grid-cols-2">
              <article className="surface-card p-6">
                <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Clock className="size-4" />
                </span>
                <h3 className="mt-4 text-lg font-semibold">Opening hours</h3>
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  {hourLines.length > 0 ? (
                    hourLines.map((line) => <li key={line}>{line}</li>)
                  ) : (
                    <li>Hours not set yet.</li>
                  )}
                </ul>
              </article>

              <article className="surface-card p-6">
                <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Trophy className="size-4" />
                </span>
                <h3 className="mt-4 text-lg font-semibold">Weekly rest day</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {closedLabel ? `Closed ${closedLabel}` : "Open every hour, every day."}
                </p>
                {closedLabel && <p className="mt-2 text-sm text-muted-foreground">Closed for Sabbath rest.</p>}
              </article>
            </div>

            {/* Full width, not a peer of the short cards above — the daily bands are far
                wordier than any of them and a one-quarter column left it lopsided. */}
            <article className="mt-6 surface-card p-6">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Wallet className="size-4" />
                </span>
                <h3 className="text-lg font-semibold">Court rates</h3>
              </div>
              {rateGroups.length > 0 ? (
                <>
                  <div className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-2">
                    {rateGroups.map((group) => (
                      <div key={group.label}>
                        <p className="text-xs font-semibold uppercase tracking-wide text-foreground">
                          {group.label}
                        </p>
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
          </div>

          {/* Label, heading, then a card below at the same `mt-8` offset the left
              column uses — so both first cards start on the same row instead of
              one being pushed down by a paragraph the other side doesn't have.
              The description moves inside the card, as its lead line. */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Events &amp; groups</p>
            <h2 className="mt-3 text-3xl font-bold leading-[1.05] md:text-4xl">Host an event</h2>

            <div className="mt-8 surface-card p-6">
              <p className="text-sm leading-relaxed text-muted-foreground">
                Planning a tournament, a group booking, a corporate team building or a special occasion? Talk to us
                directly and we will block out the courts you need.
              </p>
              <div className="mt-5 space-y-3">
                {[
                  { key: "person", label: "Talk to", value: settings.contactPerson, icon: User, href: null },
                  {
                    key: "phone",
                    label: "Call / SMS",
                    value: settings.contactPhone,
                    icon: Phone,
                    href: settings.contactPhone ? `tel:${settings.contactPhone.replace(/\s+/g, "")}` : null,
                  },
                  {
                    key: "email",
                    label: "Email address",
                    value: settings.contactEmail,
                    icon: Mail,
                    href: settings.contactEmail ? `mailto:${settings.contactEmail}` : null,
                  },
                ]
                  /* A blank setting is left out entirely rather than rendered as an
                     em dash — an empty contact row is worse than one row fewer. */
                  .filter((row) => row.value)
                  .map(({ key, label, value, icon: Icon, href }) => {
                    const body = (
                      <>
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                          <Icon className="size-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                            {label}
                          </span>
                          <span className="block truncate font-semibold">{value}</span>
                        </span>
                      </>
                    );
                    const className = "flex items-center gap-3 rounded-xl border border-border bg-secondary/40 p-4";
                    return href ? (
                      <a key={key} href={href} className={`${className} transition-colors hover:bg-accent`}>
                        {body}
                      </a>
                    ) : (
                      <div key={key} className={className}>
                        {body}
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-border bg-secondary/40 px-4 py-16">
        <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-center lg:gap-10">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">The home of pickleball</p>
            <h2 className="mt-3 text-4xl font-bold leading-[1.05] md:text-5xl">{settings.businessName}</h2>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">
              {courts.length} dedicated {courts.length === 1 ? "court" : "courts"} built for the Tagum pickleball
              community. Whether you are picking up a paddle for the first time or chasing a competitive third-shot
              drop, there is a court here with your name on it — book it by the hour, any hour we are open.
            </p>
          </div>

          {/* The address is the only thing the admin has to keep current: the
              pin, the embed and the directions link are all keyed off it. Capped
              narrower than the text column and pinned right, so it reads as a
              supporting locator rather than competing with the headline. */}
          <div className="surface-card overflow-hidden lg:max-w-sm lg:justify-self-end">
            <div className="relative aspect-[4/3] w-full bg-muted">
              {settings.address ? (
                <>
                  <iframe
                    title={`Map to ${settings.businessName}`}
                    src={mapsEmbedUrl(settings.address)}
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                    className="absolute inset-0 size-full border-0"
                  />
                  <a
                    href={mapsSearchUrl(settings.address)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-lg bg-card/90 px-2.5 py-1.5 text-xs font-semibold text-foreground shadow-card backdrop-blur transition-colors hover:bg-card"
                  >
                    Open in Maps
                    <ExternalLink className="size-3.5" />
                  </a>
                </>
              ) : (
                <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted-foreground">
                  Add the court address in Settings to show the map.
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-4">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <MapPin className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Our location
                  </p>
                  <p className="truncate font-semibold">{settings.address || "Tagum City, Davao del Norte"}</p>
                </div>
              </div>
              {settings.address && (
                <a
                  href={mapsDirectionsUrl(settings.address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-4 py-2 text-xs font-semibold uppercase tracking-wide transition-colors hover:bg-accent"
                >
                  Directions
                  <ArrowRight className="size-3.5" />
                </a>
              )}
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8">
          <div className="flex items-center gap-2 font-display text-sm font-bold text-foreground">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <CalendarCheck className="size-4" />
            </span>
            {settings.businessName}
          </div>
          <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
            <Link href="/" className="transition-colors hover:text-foreground">
              Home
            </Link>
            <Link href="/book" className="transition-colors hover:text-foreground">
              Book a court
            </Link>
            <a href="#details" className="transition-colors hover:text-foreground">
              Rates &amp; hours
            </a>
          </nav>
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} {settings.businessName}. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
