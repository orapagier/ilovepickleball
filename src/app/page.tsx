import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import Image from "next/image";
import { DateTime } from "luxon";
import { ArrowRight, ExternalLink, Mail, MapPin, Phone } from "lucide-react";
import {
  getSettings,
  getActiveCourts,
  getBusinessHours,
  getPriceTiers,
  getBlackoutDateSet,
  getBusyIntervalsByCourt,
} from "@/lib/booking-data";
import { buildAvailability, rangeUtcBounds, MAX_ADVANCE_DAYS, type BusinessHourRow } from "@/lib/scheduling";
import { getSessionUser } from "@/lib/auth-helpers";
import { summarizeHours, closedWindowLabel } from "@/lib/hours-summary";
import { formatMoney, formatMinuteOfDay, splitMoney } from "@/lib/format";
import { minTierRateCents, groupTiersByWeekday } from "@/lib/pricing";
import { getLatestChampion, getTournamentPromo } from "@/lib/tournament-data";
import { TournamentPromo } from "@/components/tournament/tournament-promo";
import { ChampionCard } from "@/components/tournament/champion-card";
import { HeroBooking, type OpenHour } from "@/components/hero-booking";

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

/**
 * Today's remaining hours, with how many courts are still free in each.
 *
 * One query for every court's bookings, then the same `buildAvailability` the
 * booking grid runs — so the homepage can never disagree with the page it sends
 * people to. Slots already gone (past, or inside the notice window) drop out;
 * what's left is the strip in the hero.
 */
async function openHoursToday(params: {
  courtIds: number[];
  tz: string;
  slotDurationMin: number;
  leadMinutes: number;
  hours: BusinessHourRow[];
  blackouts: Set<string>;
  todayISO: string;
}): Promise<OpenHour[]> {
  const { courtIds, tz, slotDurationMin, leadMinutes, hours, blackouts, todayISO } = params;
  if (courtIds.length === 0) return [];

  const { start, end } = rangeUtcBounds(tz, todayISO, todayISO);
  const busyByCourt = await getBusyIntervalsByCourt(courtIds, start, end);
  const now = new Date();

  const byStart = new Map<number, OpenHour>();
  for (const courtId of courtIds) {
    const [day] = buildAvailability({
      tz,
      slotDurationMin,
      leadMinutes,
      hours,
      blackouts,
      busy: busyByCourt.get(courtId) ?? [],
      fromISO: todayISO,
      toISO: todayISO,
      now,
    });
    for (const slot of day?.slots ?? []) {
      if (slot.status === "past") continue;
      const ms = slot.start.getTime();
      const row = byStart.get(ms) ?? { startMs: ms, label: slot.label, free: [], courts: 0 };
      row.courts += 1;
      if (slot.available) row.free.push(courtId);
      byStart.set(ms, row);
    }
  }

  return [...byStart.values()].sort((a, b) => a.startMs - b.startMs);
}

export default async function Home() {
  const [settings, courts, hours, tiers, user, promo, champion, blackouts] = await Promise.all([
    getSettings(),
    getActiveCourts(),
    getBusinessHours(),
    getPriceTiers(),
    getSessionUser(),
    // Two aggregate queries, in parallel with everything else this page already
    // waits on, so the tile costs the homepage no wall clock at all.
    getTournamentPromo(),
    getLatestChampion(),
    getBlackoutDateSet(),
  ]);

  const today = DateTime.now().setZone(settings.timezone);
  const todayISO = today.toFormat("yyyy-LL-dd");
  const openHours = await openHoursToday({
    courtIds: courts.map((c) => c.id),
    tz: settings.timezone,
    slotDurationMin: settings.slotDurationMin,
    leadMinutes: settings.leadMinutes,
    hours,
    blackouts,
    todayISO,
  });

  const hourLines = summarizeHours(hours);
  const closedLabel = closedWindowLabel(hours);
  const hasHeroImage = fs.existsSync(HERO_IMAGE_PATH);
  const startingRate = splitMoney(minTierRateCents(tiers, settings.priceCentsPerHour), settings.currency);
  const rateGroups = groupTiersByWeekday(tiers);
  const bookHref = user ? "/book" : "/signin";

  /* Closed all day and "today is simply over" are different facts, and somebody
     deciding whether to come down now needs the right one. */
  const openAtAllToday =
    !blackouts.has(todayISO) && hours.some((h) => h.weekday === today.weekday % 7);
  const closedNote = openAtAllToday
    ? "Every slot left today has already started. Pick a day ahead and the court is yours."
    : "We're closed today. Pick a day ahead and the court is yours.";

  return (
    <div className="flex flex-1 flex-col">
      {/* ---------------------------------------------------------------- Hero */}
      {/* The courts themselves at dusk, with the one thing a visitor came to
          find out sitting in glass on top of them: what is free, and when. The
          photograph carries the place; the card carries the answer. */}
      <section className="dusk-panel relative isolate overflow-hidden">
        {hasHeroImage && (
          <>
            <Image
              src="/hero-court.jpg"
              alt=""
              fill
              priority
              sizes="100vw"
              className="-z-20 object-cover object-center"
            />
            {/* An even scrim rather than a dark half: the courts are the same
                photograph on the left of the frame as on the right, and burying
                them under an opaque panel to seat the headline threw away the
                only picture on the page. The type carries its own contrast
                instead — see `.on-photo`. */}
            <div className="absolute inset-0 -z-10 bg-gradient-to-b from-dusk/72 via-dusk/62 to-dusk/78 lg:bg-gradient-to-r lg:from-dusk/58 lg:via-dusk/50 lg:to-dusk/48" />
          </>
        )}
        <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:py-20 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16 lg:py-28">
          <div>
            <p className="eyebrow eyebrow-on-dusk on-photo rise">Tagum City · Davao del Norte</p>
            <h1
              className="on-photo rise mt-5 text-[2.75rem] leading-[0.95] sm:text-6xl lg:text-[4.5rem]"
              style={{ "--rise-delay": "80ms" } as React.CSSProperties}
            >
              {settings.businessName}
            </h1>
            <p
              className="on-photo rise mt-5 max-w-md text-base leading-relaxed text-dusk-foreground/90 sm:text-lg"
              style={{ "--rise-delay": "160ms" } as React.CSSProperties}
            >
              Courts by the hour, paid on your phone, held the moment you send the reference. Bring a paddle —
              the net is already up.
            </p>

            <div
              className="rise mt-8 flex flex-wrap gap-3"
              style={{ "--rise-delay": "220ms" } as React.CSSProperties}
            >
              <Link href={bookHref} className="btn btn-primary px-6 py-3.5">
                {user ? "Book a court" : "Sign in to book"}
                <ArrowRight className="size-4" />
              </Link>
              <a href="#rates" className="btn btn-on-dusk px-6 py-3.5">
                Rates &amp; hours
              </a>
            </div>
          </div>

          {/* The signature: real availability, not an illustration of it.
              `min-w-0` because the card holds a swipeable date strip: a grid
              item's automatic minimum is its content's min-content width, so
              without it the column sizes to all thirty days and the card runs
              off the side of a phone instead of scrolling inside itself. */}
          <div className="min-w-0 lg:justify-self-end lg:w-full lg:max-w-md">
            <HeroBooking
              courts={courts.map((c) => ({ id: c.id, name: c.name }))}
              dates={Array.from({ length: MAX_ADVANCE_DAYS + 1 }, (_, i) => today.plus({ days: i }).toFormat("yyyy-LL-dd"))}
              initialHours={openHours}
              closedNote={closedNote}
              rate={startingRate}
              signedIn={!!user}
            />
          </div>
        </div>
      </section>

      {/* Directly under the hero: the one thing on this page that is different
          this week, in front of the hours and rates a returning member has
          already read. Renders nothing when there is no tournament to promote. */}
      <TournamentPromo live={promo.live} open={promo.open} tz={settings.timezone} />

      {/* --------------------------------------------------------- How it works */}
      {/* Numbered because booking genuinely is a sequence — the steps happen in
          this order and you cannot pay before you have picked a slot. */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:py-20">
          <p className="eyebrow">Booking a court</p>
          <h2 className="mt-4 text-3xl sm:text-4xl">Three taps, then play</h2>
          <ol className="mt-8 grid gap-4 sm:grid-cols-3 sm:gap-5">
            {[
              {
                title: "Pick your slots",
                body: `Choose a day, a court and as many ${settings.slotDurationMin}-minute slots in a row as you want.`,
              },
              {
                title: "Pay on your phone",
                body: "GCash, BDO or QRPh. Booking four hours or more? Call us and we'll arrange it instead.",
              },
              {
                title: "Play",
                body: `The court is held the moment your reference lands — ${settings.holdMinutes} minutes to pay before the slot goes back.`,
              },
            ].map(({ title, body }, i) => (
              <li key={title} className="surface-card flex flex-col gap-2 p-5">
                <span className="figure-display flex size-9 items-center justify-center rounded-full bg-primary/10 text-base text-primary">
                  {i + 1}
                </span>
                <h3 className="mt-1 text-lg">{title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ------------------------------------------------------- Hours & rates */}
      <section id="rates" className="scroll-mt-20 border-b border-border">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:py-20 lg:grid-cols-[1fr_0.85fr] lg:gap-14">
          <div>
            <p className="eyebrow">Plan your visit</p>
            <h2 className="mt-4 text-3xl sm:text-4xl">Hours &amp; rates</h2>

            <div className="surface-card mt-7 divide-y divide-border">
              <div className="p-5 sm:p-6">
                <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  When we&rsquo;re open
                </h3>
                <dl className="mt-4 grid gap-x-8 gap-y-2.5 sm:grid-cols-2">
                  {hourLines.length > 0 ? (
                    hourLines.map((line) => {
                      const [day, ...rest] = line.split(": ");
                      return (
                        <div key={line} className="flex items-baseline justify-between gap-4 sm:justify-start">
                          <dt className="w-20 shrink-0 text-sm font-bold">{day}</dt>
                          <dd className="data-value text-xs text-muted-foreground">{rest.join(": ")}</dd>
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-sm text-muted-foreground">Hours not set yet.</p>
                  )}
                </dl>
                {closedLabel && (
                  <p className="mt-5 border-t border-border pt-3.5 text-sm text-muted-foreground">
                    Closed <span className="font-bold text-foreground">{closedLabel}</span> for Sabbath rest.
                  </p>
                )}
              </div>

              <div className="p-5 sm:p-6">
                <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  What it costs
                </h3>
                {rateGroups.length > 0 ? (
                  <>
                    <div className="mt-4 grid gap-x-10 gap-y-5 sm:grid-cols-2">
                      {rateGroups.map((group) => (
                        <div key={group.label}>
                          <p className="text-sm font-bold">{group.label}</p>
                          <dl className="mt-2 space-y-1.5">
                            {group.tiers.map((t) => (
                              <div
                                key={`${t.startMin}-${t.endMin}`}
                                className="flex items-baseline justify-between gap-3"
                              >
                                <dt className="data-value text-xs font-medium text-muted-foreground">
                                  {formatMinuteOfDay(t.startMin)}–{formatMinuteOfDay(t.endMin)}
                                </dt>
                                <dd className="figure-display text-base">
                                  {formatMoney(t.priceCentsPerHour, settings.currency)}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      ))}
                    </div>
                    {/* A day-specific band overrides the every-day one, so say which wins
                        rather than leaving two rates for the same hour unexplained. */}
                    {rateGroups.length > 1 && (
                      <p className="mt-5 border-t border-border pt-3.5 text-xs text-muted-foreground">
                        A day&rsquo;s own rate applies instead of the every-day rate.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="mt-4">
                    <span className="figure-display text-2xl">
                      {formatMoney(settings.priceCentsPerHour, settings.currency)}
                    </span>
                    <span className="ml-1.5 text-xs font-medium text-muted-foreground">/hr, every day</span>
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Events sit beside the rates because they are the same question asked
              at a larger size — "can I have the courts, and what will it cost". */}
          <div>
            <p className="eyebrow">Events &amp; groups</p>
            <h2 className="mt-4 text-3xl sm:text-4xl">Host an event</h2>

            <div className="surface-card mt-7 p-5 sm:p-6">
              <p className="text-sm leading-relaxed text-muted-foreground">
                Planning a tournament, a group booking, a corporate team building or a birthday? Talk to us and
                we&rsquo;ll block out the courts you need.
              </p>
              <div className="mt-5 divide-y divide-border border-t border-border">
                {[
                  { key: "person", label: "Talk to", value: settings.contactPerson, icon: null, href: null },
                  {
                    key: "phone",
                    label: "Call or SMS",
                    value: settings.contactPhone,
                    icon: Phone,
                    href: settings.contactPhone ? `tel:${settings.contactPhone.replace(/\s+/g, "")}` : null,
                  },
                  {
                    key: "email",
                    label: "Email",
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
                        <span className="w-24 shrink-0 text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                          {label}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-bold">{value}</span>
                        {Icon && <Icon className="size-4 shrink-0 text-primary" />}
                      </>
                    );
                    const className = "flex items-center gap-3 py-3.5 text-sm";
                    return href ? (
                      <a key={key} href={href} className={`${className} transition-colors hover:text-primary`}>
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

            {/* The space under the contact card, spent on the one thing this
                page had nothing to say about: that tournaments are played here
                and somebody wins them. Nothing at all until one has been. */}
            {champion && <ChampionCard champion={champion} tz={settings.timezone} />}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ Location */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:py-20">
          <div className="grid gap-8 lg:grid-cols-[1fr_0.85fr] lg:items-end lg:gap-14">
            <div>
              <p className="eyebrow">The home of pickleball in Tagum</p>
              <h2 className="mt-4 text-3xl sm:text-4xl">Find us</h2>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground">
                {courts.length} dedicated {courts.length === 1 ? "court" : "courts"} for the Tagum pickleball
                community. Whether you&rsquo;re picking up a paddle for the first time or chasing a competitive
                third-shot drop, there&rsquo;s a court here with your name on it.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 lg:justify-end">
              <Link href={bookHref} className="btn btn-primary">
                Book a court
                <ArrowRight className="size-4" />
              </Link>
              {settings.address && (
                <a
                  href={mapsDirectionsUrl(settings.address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-outline"
                >
                  Get directions
                  <ExternalLink className="size-3.5" />
                </a>
              )}
            </div>
          </div>

          {/* The map, and only the map — the hero already shows what the place
              looks like. The address is the one thing the admin has to keep
              current: the pin, the embed and the directions link all key off it. */}
          <div className="mt-8">
            <div className="surface-card flex flex-col overflow-hidden">
              <div className="relative aspect-[4/3] w-full flex-1 bg-muted md:aspect-[21/9]">
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
                      className="glass-panel absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold shadow-card transition-colors hover:text-primary"
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
              <div className="flex items-start gap-3 border-t border-border p-4">
                <MapPin className="mt-0.5 size-4 shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="text-[0.65rem] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                    Our location
                  </p>
                  <p className="mt-0.5 font-bold">{settings.address || "Tagum City, Davao del Norte"}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------------- Footer */}
      {/* Runs under the phone's tab bar rather than stopping above it, so the
          dusk reaches the bottom edge and the bar frosts it. */}
      <footer className="dusk-panel under-tabbar md:mb-0 md:pb-10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-8 gap-y-5 px-4 pt-10">
          <p className="font-display text-lg font-semibold">{settings.businessName}</p>
          <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-dusk-foreground/70">
            <Link href="/" className="transition-colors hover:text-dusk-foreground">
              Home
            </Link>
            <Link href="/book" className="transition-colors hover:text-dusk-foreground">
              Book a court
            </Link>
            <Link href="/tournaments" className="transition-colors hover:text-dusk-foreground">
              Tournaments
            </Link>
            <a href="#rates" className="transition-colors hover:text-dusk-foreground">
              Rates &amp; hours
            </a>
          </nav>
          <p className="text-xs text-dusk-foreground/50">
            © {new Date().getFullYear()} {settings.businessName}
          </p>
        </div>
      </footer>
    </div>
  );
}
