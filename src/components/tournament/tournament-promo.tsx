import Link from "next/link";
import { ArrowRight, CalendarClock, Radio, Trophy, Users } from "lucide-react";
import { formatDateTimeLabel, formatMoney } from "@/lib/format";
import { formatSkillBand } from "@/lib/skill";
import { FORMAT_LABELS, PLAY_TYPE_LABELS } from "@/lib/tournament";
import type { PromoTournament } from "@/lib/tournament-data";
import { TournamentChip } from "@/components/tournament/status-badge";

/**
 * The tournament tile on the homepage: what is being played right now, and what
 * can still be entered.
 *
 * It sits directly under the hero because it is the only thing on this page
 * that changes week to week — everything below it is hours, rates and an
 * address, which a returning member has already read. It is written as a promo
 * rather than a data dump for the same reason: the job is to get somebody onto
 * `/tournaments`, not to be a second tournaments page.
 *
 * Renders nothing at all when there is neither a live tournament nor an open
 * one. An empty "no tournaments" panel would take the most valuable strip on
 * the homepage to say that there is nothing to say.
 */
export function TournamentPromo({
  live,
  open,
  tz,
}: {
  live: PromoTournament[];
  open: PromoTournament[];
  tz: string;
}) {
  if (live.length === 0 && open.length === 0) return null;

  return (
    <section className="border-b border-border px-4 py-14 sm:py-20">
      <div className="mx-auto flex max-w-6xl flex-col gap-7">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">On the courts</p>
            <h2 className="mt-4 text-3xl sm:text-4xl">Tournaments</h2>
          </div>
          <Link href="/tournaments" className="btn btn-outline shrink-0">
            See all
            <ArrowRight className="size-3.5" />
          </Link>
        </div>

        {/* One column when only one card has anything in it, so a solitary tile
            doesn't sit in half a row with a hole beside it. */}
        <div className={live.length > 0 && open.length > 0 ? "grid gap-4 md:grid-cols-2" : "grid gap-4"}>
          {live.length > 0 && <HappeningNow tournaments={live} />}
          {open.length > 0 && <OpenToEnter tournaments={open} tz={tz} />}
        </div>
      </div>
    </section>
  );
}

/** Where a promo card points: straight at the tournament when it is the only
 *  one, and at the browse page when there is a choice to make. */
function destination(tournaments: PromoTournament[]): string {
  return tournaments.length === 1 ? `/tournaments/${tournaments[0].id}` : "/tournaments";
}

/**
 * The live card, on the dusk panel — the same ground as the hero, so the thing
 * happening this minute is the one tile on the page that carries the club's
 * colour rather than sitting on white.
 */
function HappeningNow({ tournaments }: { tournaments: PromoTournament[] }) {
  return (
    <Link
      href={destination(tournaments)}
      className="dusk-panel relative flex flex-col gap-4 overflow-hidden rounded-2xl p-6 shadow-raised transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-lift"
    >
      {/* `flex-1` so the "follow it live" line can sit on the bottom edge and
          line up with the other card's call to action, whichever of the two has
          more in it. */}
      <div className="relative flex flex-1 flex-col gap-4">
        {/* The bloom gold, on the one tile that is genuinely live. */}
        <p className="inline-flex items-center gap-2 self-start rounded-full bg-bloom px-3 py-1.5 text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-bloom-foreground">
          <Radio className="bloom-pulse size-3.5" />
          Happening now
        </p>

        <ul className="flex flex-col gap-3.5">
          {tournaments.slice(0, 2).map((t) => (
            <li key={t.id} className="flex flex-col gap-1.5">
              <p className="font-display text-xl font-semibold leading-tight">{t.name}</p>
              <p className="text-xs text-dusk-foreground/60">
                {FORMAT_LABELS[t.format]} · {PLAY_TYPE_LABELS[t.playType]} · {t.entries} entries
              </p>
              <ProgressLine t={t} />
            </li>
          ))}
        </ul>

        {tournaments.length > 2 && (
          <p className="text-xs text-dusk-foreground/60">
            + {tournaments.length - 2} more being played right now
          </p>
        )}

        <p className="mt-auto inline-flex items-center gap-1.5 text-sm font-semibold text-dusk-foreground">
          Follow it live
          <ArrowRight className="size-4" />
        </p>
      </div>
    </Link>
  );
}

/**
 * How far a tournament has got, said the way somebody watching would say it.
 *
 * The round is the useful half — "round 3 of 4" is a position in the day, where
 * "18 matches played" is only a number until you know how many there are. Both
 * are there, in that order.
 *
 * Only the round marker is set as data — tabular figures in a tinted pill. The
 * sentence beside it is running text and stays running text.
 */
function ProgressLine({ t }: { t: PromoTournament }) {
  if (t.currentRound == null) {
    return (
      <p className="text-sm text-dusk-foreground/85">
        All {t.drawn} matches played — the final result is going up now
      </p>
    );
  }
  return (
    <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
      <span className="data-value rounded-full bg-white/12 px-2.5 py-1 text-xs">Round {t.currentRound}</span>
      <span className="text-xs text-dusk-foreground/70">
        {t.decided} of {t.drawn} matches in
      </span>
    </p>
  );
}

/** The entry card: everything somebody deciding whether to enter has to weigh,
 *  and nothing else. */
function OpenToEnter({ tournaments, tz }: { tournaments: PromoTournament[]; tz: string }) {
  return (
    <Link
      href={destination(tournaments)}
      className="surface-card flex flex-col gap-4 p-6 transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-raised"
    >
      <p className="inline-flex items-center gap-2 self-start rounded-full bg-primary/12 px-3 py-1.5 text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-primary">
        <Trophy className="size-3.5" />
        Open to enter
      </p>

      <ul className="flex flex-col gap-4">
        {tournaments.slice(0, 2).map((t) => {
          const spots = Math.max(0, t.maxEntries - t.entries);
          return (
            <li key={t.id} className="flex flex-col gap-2">
              <p className="font-display text-xl font-semibold leading-tight">{t.name}</p>
              <div className="flex flex-wrap gap-1.5">
                <TournamentChip>{FORMAT_LABELS[t.format]}</TournamentChip>
                <TournamentChip>{PLAY_TYPE_LABELS[t.playType]}</TournamentChip>
                <TournamentChip>{formatSkillBand(t.minSkillRating, t.maxSkillRating)}</TournamentChip>
              </div>
              <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                <div className="flex items-center gap-1.5">
                  <dt className="sr-only">Entry fee</dt>
                  <dd className={t.entryFeeCents > 0 ? "figure-display text-base" : "font-bold"}>
                    {t.entryFeeCents > 0 ? formatMoney(t.entryFeeCents, t.currency) : "Free to enter"}
                  </dd>
                </div>
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Users className="size-3.5 shrink-0 text-primary" />
                  <dt className="sr-only">Spots left</dt>
                  {/* A full draw still takes entries — they go on the waitlist —
                      so "full" is the honest word rather than "closed". */}
                  <dd>{spots > 0 ? `${spots} ${spots === 1 ? "spot" : "spots"} left` : "Full — waitlist open"}</dd>
                </div>
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <CalendarClock className="size-3.5 shrink-0 text-primary" />
                  <dt className="sr-only">Entries close</dt>
                  <dd>Closes {formatDateTimeLabel(t.registrationClosesAt, tz)}</dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ul>

      {tournaments.length > 2 && (
        <p className="text-xs text-muted-foreground">+ {tournaments.length - 2} more taking entries</p>
      )}

      <p className="mt-auto inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
        Enter now
        <ArrowRight className="size-4" />
      </p>
    </Link>
  );
}
