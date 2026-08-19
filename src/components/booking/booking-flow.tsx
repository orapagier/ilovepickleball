"use client";

import { Fragment, useEffect, useRef, useState, useActionState } from "react";
import Link from "next/link";
import { CalendarDays, Check, ChevronLeft, ChevronRight, Info, Lock, Sunset } from "lucide-react";
import { createBooking, type ActionState } from "@/lib/actions/booking-actions";
import { SignInButton } from "@/components/auth-buttons";
import { formatMoney, formatMoneyCompact, formatDateLabel, formatMinuteOfDay, dateStripParts } from "@/lib/format";
import { groupSlotsIntoRuns, MAX_SELECTED_SLOTS } from "@/lib/scheduling";
import { localMinuteOfDay, localWeekday, tierRateForMinute, type PriceTier } from "@/lib/pricing";
import { SABBATH_END, SABBATH_START, sabbathBound } from "@/lib/hours-summary";
import { cn } from "@/lib/utils";

const CALL_REQUIRED_HOURS = 4;

type Court = { id: number; name: string };
type SlotStatus = "available" | "confirmed" | "pending" | "past";
type Slot = {
  date: string;
  startMs: number;
  label: string;
  available: boolean;
  status: SlotStatus;
  /** Who holds the slot — empty for anything that isn't currently booked. */
  bookedBy: string;
};

/** A ticked cell, keyed the way the selection set holds it. */
function pickKey(courtId: number, startMs: number): string {
  return `${courtId}:${startMs}`;
}

function parsePickKey(key: string): { courtId: number; startMs: number } {
  const [courtId, startMs] = key.split(":");
  return { courtId: Number(courtId), startMs: Number(startMs) };
}

/** `iso` dates are plain YYYY-MM-DD business-local calendar dates — do all
 * arithmetic on them as UTC-midnight so a date never shifts by a day. */
function addDaysISO(iso: string, days: number): string {
  const dt = new Date(`${iso}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function daysBetweenISO(fromISO: string, toISO: string): number {
  const a = new Date(`${fromISO}T00:00:00Z`).getTime();
  const b = new Date(`${toISO}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** "08:00 AM - 09:00 AM" — the full pair, which the wide time column has room
 * for, so a row reads as a span rather than as a start time. */
function slotRangeLabel(startMin: number, endMin: number): string {
  return `${formatMinuteOfDay(startMin)} - ${formatMinuteOfDay(endMin)}`;
}

/** Day parts, matching how people talk about court times rather than any
 * business-hours boundary — a band is only rendered when it has slots. */
function dayPart(startMin: number): string {
  if (startMin < 360) return "Late night";
  if (startMin < 720) return "Morning";
  if (startMin < 1020) return "Afternoon";
  return "Evening";
}

/** What a cell says when it can't be ticked. Each state is a word rather than a
 *  colour, so the grid reads without a legend to decode it. */
const LOCKED_LABEL: Record<Exclude<SlotStatus, "available">, string> = {
  confirmed: "Booked",
  pending: "On hold",
  past: "Closed",
};

/** The second line of a taken cell: whoever holds it. A booking can't be made
 *  without a name on the profile, so the fallback is only for legacy rows. */
function holderLabel(slot: Slot): string {
  if (slot.status === "past") return "Not bookable";
  return slot.bookedBy || "A member";
}

export function BookingFlow({
  courts,
  todayISO,
  maxISO,
  priceCentsPerHour,
  currency,
  slotDurationMin: initialSlotDurationMin,
  tz,
  tiers,
  holdMinutes,
  signedIn,
  needsRegistration,
  closedLabel,
  inSabbath,
  initialDate,
  initialStart,
  initialCourt,
}: {
  courts: Court[];
  todayISO: string;
  maxISO: string;
  priceCentsPerHour: number;
  currency: string;
  slotDurationMin: number;
  tz: string;
  tiers: PriceTier[];
  holdMinutes: number;
  signedIn: boolean;
  needsRegistration: boolean;
  closedLabel: string | null;
  /** Whether the Sabbath is running as this page is served — the weekly closure
   *  notice states a closure in force, not a policy, so it only shows then. */
  inSabbath: boolean;
  /** The day, hour and court the homepage card handed over, if it did. The hour
   *  is a start time in epoch ms; the court is the one the visitor chose there,
   *  and falls back to the first that still has the hour when it has gone in
   *  the meantime. */
  initialDate?: string;
  initialStart?: number;
  initialCourt?: number;
}) {
  const [date, setDate] = useState(initialDate ?? todayISO);
  const [slotsByCourt, setSlotsByCourt] = useState<Record<number, Slot[]>>({});
  const [loading, setLoading] = useState(true);
  const [maxHours, setMaxHours] = useState(6);
  const [slotDurationMin, setSlotDurationMin] = useState(initialSlotDurationMin);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [limitNote, setLimitNote] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [state, formAction, pending] = useActionState<ActionState, FormData>(createBooking, {});
  const stripRef = useRef<HTMLDivElement>(null);
  /* Once only: the handed-over hour is a starting point, not a lock — reloading
     the day or ticking it off must not put it back. */
  const appliedStart = useRef(false);
  const [stripEdges, setStripEdges] = useState({ start: false, end: false });

  const totalAdvanceDays = daysBetweenISO(todayISO, maxISO);
  const stripDates = Array.from({ length: totalAdvanceDays + 1 }, (_, i) => addDaysISO(todayISO, i));

  /* Selections are per-day: the grid only prices the day it is showing, so
     carrying ticks across a date change would total up hours the customer can
     no longer see or untick. */
  function selectDate(d: string) {
    setDate(d);
    setSelected(new Set());
    setLimitNote(null);
    setLoading(true);
  }

  function scrollStrip(direction: -1 | 1) {
    const el = stripRef.current;
    if (el) el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: "smooth" });
  }

  /* Pull the selected day back into view when the date changes from outside the
     strip — the header arrows and the calendar picker can both land on a day
     that has been scrolled well off the end. */
  useEffect(() => {
    stripRef.current
      ?.querySelector(`[data-date="${date}"]`)
      ?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [date]);

  /* The strip's scrollbar is hidden, so its arrows have to carry the signal it
     used to give: which way there is still strip left to travel. */
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      setStripEdges({ start: el.scrollLeft > 1, end: el.scrollLeft < max - 1 });
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      courts.map((c) =>
        fetch(`/api/availability?courtId=${c.id}&date=${date}`)
          .then((r) => r.json())
          .then((data) => [c.id, data] as const),
      ),
    )
      .then((entries) => {
        if (cancelled) return;
        const byCourt: Record<number, Slot[]> = {};
        for (const [courtId, data] of entries) byCourt[courtId] = data.slots ?? [];
        setSlotsByCourt(byCourt);
        if (initialStart && !appliedStart.current) {
          appliedStart.current = true;
          const free = (id: number) => byCourt[id]?.some((s) => s.startMs === initialStart && s.available);
          const court = courts.find((c) => (initialCourt ? c.id === initialCourt && free(c.id) : free(c.id)));
          /* The chosen court taken since the homepage drew it: tick whichever
             is still free rather than nothing, so the visitor lands on an hour
             they can book instead of an empty grid. */
          const fallback = initialCourt ? courts.find((c) => free(c.id)) : undefined;
          const target = court ?? fallback;
          if (target) setSelected(new Set([pickKey(target.id, initialStart)]));
        }
        const first = entries[0]?.[1];
        if (first) {
          setMaxHours(first.maxHours ?? 6);
          setSlotDurationMin(first.slotDurationMin ?? 60);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [date, courts, initialStart, initialCourt]);

  /* Rows are the union of every court's start times for the selected day, so a
     court that is individually closed still leaves a gap in its own column
     instead of shifting the whole table out of alignment. */
  const slotByCourtAndStart = new Map<number, Map<number, Slot>>();
  const rowStartSet = new Set<number>();
  for (const court of courts) {
    const byStart = new Map<number, Slot>();
    for (const s of slotsByCourt[court.id] ?? []) {
      if (s.date !== date) continue;
      byStart.set(s.startMs, s);
      rowStartSet.add(s.startMs);
    }
    slotByCourtAndStart.set(court.id, byStart);
  }
  const rowStarts = [...rowStartSet].sort((a, b) => a - b);

  const rows = rowStarts.map((startMs) => {
    const startMin = localMinuteOfDay(new Date(startMs), tz);
    const endMin = localMinuteOfDay(new Date(startMs + slotDurationMin * 60_000), tz);
    const rateCents = tierRateForMinute(startMin, localWeekday(new Date(startMs), tz), tiers, priceCentsPerHour);
    return {
      startMs,
      part: dayPart(startMin),
      rangeLabel: slotRangeLabel(startMin, endMin),
      slotCents: Math.round((rateCents * slotDurationMin) / 60),
    };
  });
  const centsByStart = new Map(rows.map((r) => [r.startMs, r.slotCents]));

  const picks = [...selected].map(parsePickKey);
  const runs = groupSlotsIntoRuns(picks, slotDurationMin);
  /* Every cell already carries its own hour's tiered rate, so the bill is just
     their sum — no need to re-derive the bands a run spans. */
  const totalCents = picks.reduce((sum, p) => sum + (centsByStart.get(p.startMs) ?? 0), 0);
  const longestRun = runs.reduce((max, run) => Math.max(max, run.hours), 0);

  /* A pick that breaks a limit is refused rather than silently trimmed: the
     customer needs to know which limit they hit, and why the cell they just
     tapped stayed empty. */
  function toggleSlot(courtId: number, startMs: number) {
    const key = pickKey(courtId, startMs);
    const next = new Set(selected);

    if (next.has(key)) {
      next.delete(key);
      setSelected(next);
      setLimitNote(null);
      return;
    }

    if (next.size >= MAX_SELECTED_SLOTS) {
      setLimitNote(`You can book at most ${MAX_SELECTED_SLOTS} slots at a time.`);
      return;
    }

    next.add(key);
    const candidate = groupSlotsIntoRuns([...next].map(parsePickKey), slotDurationMin);
    if (candidate.some((run) => run.hours > maxHours)) {
      setLimitNote(`A court can only be booked for ${maxHours} hours in a row.`);
      return;
    }

    setSelected(next);
    setLimitNote(null);
  }

  /* Read as UTC-midnight like the rest of the ISO-date arithmetic here, so the
     weekday can't slip a day depending on the viewer's own timezone. Both days
     the Sabbath touches carry the note: Friday runs up to it, Saturday out of
     it, and each one's grid stops or starts partway through the day. */
  const selectedWeekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const isSabbathDay = selectedWeekday === SABBATH_START.weekday || selectedWeekday === SABBATH_END.weekday;
  /* Friday's bookable hours all run up to the Sabbath, so the note follows them
     as what comes next; Saturday's all run out of it, so there it comes first.
     Either way the card sits on the same side as the closure it describes. */
  const sabbathNoteAfterGrid = selectedWeekday === SABBATH_START.weekday;

  const sabbathCard = (
    <div className="surface-card flex flex-col items-center gap-4 p-5 text-center sm:p-6">
      <Sunset className="size-6 text-primary" />
      <div className="space-y-1.5">
        <h3 className="text-lg sm:text-xl">Closed for the Sabbath</h3>
        <p className="mx-auto max-w-prose text-sm text-muted-foreground">
          We keep the seventh day as a day of rest and worship, so no courts are booked from{" "}
          <span className="font-semibold text-foreground">{sabbathBound(SABBATH_START)}</span> to{" "}
          <span className="font-semibold text-foreground">{sabbathBound(SABBATH_END)}</span>. The hours shown{" "}
          {sabbathNoteAfterGrid ? "above" : "below"} are the ones outside that — we&rsquo;d love to have you then.
        </p>
      </div>
      <blockquote className="mx-auto max-w-prose rounded-2xl bg-primary/8 px-5 py-4 text-left">
        <p className="text-sm italic leading-relaxed text-foreground">
          &ldquo;Remember the sabbath day, to keep it holy. Six days shalt thou labour, and do all thy work: but the
          seventh day is the sabbath of the LORD thy God: in it thou shalt not do any work.&rdquo;
        </p>
        <footer className="mt-2 text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-primary">
          Exodus 20:8&ndash;10 (KJV)
        </footer>
      </blockquote>
    </div>
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-3 py-6 sm:gap-5 sm:px-4 sm:py-8">
      {/* Only while the Sabbath is actually on, and suppressed on the two days
          that carry the full Sabbath card below, so a visitor never reads two
          overlapping closure notices at once. */}
      {closedLabel && inSabbath && !isSabbathDay && (
        <p className="flex items-start gap-2.5 rounded-2xl bg-primary/8 px-4 py-3.5 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0 text-primary" />
          <span>Closed weekly {closedLabel} — we keep the seventh-day Sabbath.</span>
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-xl sm:text-2xl">{formatDateLabel(date)}</h2>
          <p className="mt-0.5 text-[0.6875rem] text-muted-foreground sm:text-xs">Book up to {totalAdvanceDays} days ahead</p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => selectDate(addDaysISO(date, -1))}
            disabled={date <= todayISO}
            aria-label="Previous day"
            className="flex size-10 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-card"
          >
            <ChevronLeft className="size-4" />
          </button>

          {/* The date input is stretched transparently over the icon so the whole
              square is the hit target; desktop browsers won't open the picker on
              a plain click, hence the explicit showPicker(). */}
          <div className="relative flex size-10 items-center justify-center rounded-full border border-border bg-card text-muted-foreground focus-within:ring-2 focus-within:ring-ring">
            <CalendarDays className="size-4" />
            <input
              type="date"
              aria-label="Pick a date"
              min={todayISO}
              max={maxISO}
              value={date}
              onClick={(e) => {
                try {
                  e.currentTarget.showPicker();
                } catch {
                  // Unsupported, or the browser already opened it on tap.
                }
              }}
              onChange={(e) => e.target.value && selectDate(e.target.value)}
              className="absolute inset-0 size-full cursor-pointer opacity-0"
            />
          </div>

          <button
            type="button"
            onClick={() => selectDate(addDaysISO(date, 1))}
            disabled={date >= maxISO}
            aria-label="Next day"
            className="flex size-10 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-card"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      {/* Every bookable day on one swipeable line, so picking a nearby date is a
          thumb-flick rather than a trip through the calendar picker. The
          scrollbar is hidden at every width; a phone swipes the strip, and the
          flanking arrows — which only appear once there is somewhere to go —
          step it along on a laptop, where a mouse can't scroll sideways. */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => scrollStrip(-1)}
          disabled={!stripEdges.start}
          aria-label="Scroll dates backward"
          className="hidden size-9 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:hover:bg-card sm:flex"
        >
          <ChevronLeft className="size-4" />
        </button>

        {/* The negative margin lets cells scroll to the screen edge on a phone;
            the scroll stays inside this box, so the page never widens. */}
        <div
          ref={stripRef}
          className="no-scrollbar -mx-3 flex min-w-0 flex-1 snap-x snap-mandatory gap-1.5 overflow-x-auto px-3 pb-1 sm:mx-0 sm:gap-2 sm:px-0"
        >
          {stripDates.map((d) => {
            const { weekday, day, month } = dateStripParts(d);
            const isActive = d === date;
            return (
              <button
                key={d}
                type="button"
                data-date={d}
                onClick={() => selectDate(d)}
                aria-pressed={isActive}
                aria-label={formatDateLabel(d)}
                className={cn(
                  "flex min-w-14 shrink-0 snap-start flex-col items-center gap-0.5 rounded-2xl border px-2 py-2.5 transition-[colors,box-shadow] sm:min-w-16",
                  isActive
                    ? "border-transparent bg-primary text-primary-foreground shadow-glow"
                    : "border-border bg-card text-foreground hover:border-primary/60 hover:bg-accent",
                  /* Today keeps a faint ring so the strip still reads as "starts
                     here" once it has been scrolled away from the left edge. */
                  !isActive && d === todayISO && "ring-1 ring-primary/40",
                )}
              >
                {/* Opacity rather than a muted token, so the two small lines stay
                    legible against the filled background of the selected cell. */}
                <span className="text-[10px] font-semibold uppercase tracking-wide opacity-70">{weekday}</span>
                <span className="data-value text-base font-bold leading-none sm:text-lg">{day}</span>
                <span className="text-[10px] uppercase opacity-70">{month}</span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => scrollStrip(1)}
          disabled={!stripEdges.end}
          aria-label="Scroll dates forward"
          className="hidden size-9 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:hover:bg-card sm:flex"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      {isSabbathDay && !sabbathNoteAfterGrid && sabbathCard}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading availability…</p>
      ) : rows.length === 0 ? (
        <p className="surface-card p-6 text-center text-sm text-muted-foreground">Closed this day.</p>
      ) : (
        <>
          <div className="surface-card overflow-hidden">
            <div className="overflow-x-auto">
            {/* The grid fills the card rather than sizing to its content, so two
                courts stay side by side on a phone instead of pushing the time
                column off-screen. Columns only stop shrinking at their minimums
                (the `--*-col` vars, widened from `sm` up), and the card scrolls
                horizontally past that — i.e. once there are too many courts. */}
            <div
              className="grid min-w-full [--court-col:6.5rem] [--time-col:6.75rem] sm:[--court-col:9rem] sm:[--time-col:11rem]"
              style={{
                gridTemplateColumns: `minmax(var(--time-col), auto) repeat(${courts.length}, minmax(var(--court-col), 1fr))`,
              }}
            >
              <div className="border-b border-border bg-secondary/60 px-3 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground sm:px-4 sm:py-4 sm:text-xs">
                Time schedule
              </div>
              {courts.map((court) => (
                <div
                  key={court.id}
                  className="border-b border-border bg-secondary/60 px-3 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground sm:px-4 sm:py-4 sm:text-xs"
                >
                  {court.name}
                </div>
              ))}

              {rows.map((row, i) => {
                const showBand = i === 0 || rows[i - 1].part !== row.part;
                /* The card's own border draws the bottom edge, so the last row
                   skips its rule rather than doubling up on it. */
                const rule = i === rows.length - 1 ? "" : "border-b border-border";
                return (
                  <Fragment key={row.startMs}>
                    {/* Tinted with the primary hue rather than `secondary`, so the
                        day-part divider reads as its own thing against the court
                        header and the time column, which share that neutral. */}
                    {showBand && (
                      <div className="col-span-full border-b border-border bg-primary/10 px-3 py-1.5 text-[0.625rem] font-bold uppercase tracking-[0.14em] text-primary sm:px-4 sm:text-xs">
                        {row.part}
                      </div>
                    )}

                    <div className={cn("flex items-center px-3 py-2 sm:px-4", rule)}>
                      {/* Nowrap keeps the pair on one line; the `auto` track
                          widens to fit it rather than the label wrapping. */}
                      <span className="data-value whitespace-nowrap text-[0.625rem] font-bold sm:text-xs">
                        {row.rangeLabel}
                      </span>
                    </div>

                    {courts.map((court) => {
                      const slot = slotByCourtAndStart.get(court.id)?.get(row.startMs);
                      const isPicked = selected.has(pickKey(court.id, row.startMs));

                      /* No slot at all on this court for this row — the other
                         courts are open now, this one simply has no such hour. */
                      if (!slot) {
                        return (
                          <div key={court.id} className={cn("flex items-center p-1.5 sm:p-2", rule)}>
                            <span className="flex h-12 w-full items-center justify-center text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/50 sm:text-xs">
                              N/A
                            </span>
                          </div>
                        );
                      }

                      /* Taken cells lead with their state and then name whoever
                         holds it, mirroring the open cell's state-then-detail
                         stack so a column reads down consistently. */
                      if (!slot.available) {
                        const state = LOCKED_LABEL[slot.status as Exclude<SlotStatus, "available">];
                        const holder = holderLabel(slot);
                        return (
                          <div key={court.id} className={cn("flex items-center p-1.5 sm:p-2", rule)}>
                            <span
                              title={`${state} — ${holder}`}
                              className="flex h-12 w-full items-center justify-between gap-1.5 rounded-xl bg-muted px-2.5 text-muted-foreground sm:gap-2 sm:px-3"
                            >
                              <span className="flex min-w-0 flex-col items-start leading-tight">
                                <span className="text-[9px] font-semibold uppercase tracking-[0.12em] opacity-70 sm:text-[10px]">
                                  {state}
                                </span>
                                <span className="max-w-full truncate text-[11px] font-semibold sm:text-xs">
                                  {holder}
                                </span>
                              </span>
                              <Lock className="size-3.5 shrink-0 opacity-70" />
                            </span>
                          </div>
                        );
                      }

                      return (
                        <div key={court.id} className={cn("flex items-center p-1.5 sm:p-2", rule)}>
                          <button
                            type="button"
                            onClick={() => toggleSlot(court.id, row.startMs)}
                            aria-pressed={isPicked}
                            aria-label={`${court.name}, ${row.rangeLabel}, open, ${formatMoney(row.slotCents, currency)}`}
                            className={cn(
                              "flex h-12 w-full items-center justify-between gap-1.5 rounded-xl border px-2.5 transition-[colors,box-shadow] sm:gap-2 sm:px-3",
                              isPicked
                                ? "border-transparent bg-primary text-primary-foreground shadow-glow"
                                : "border-border bg-card text-foreground hover:border-primary/60 hover:bg-accent",
                            )}
                          >
                            <span className="flex min-w-0 flex-col items-start leading-tight">
                              <span className="text-[9px] font-semibold uppercase tracking-[0.12em] opacity-70 sm:text-[10px]">
                                Open
                              </span>
                              <span className="data-value max-w-full truncate text-xs font-bold sm:text-sm">
                                {formatMoneyCompact(row.slotCents, currency)}
                              </span>
                            </span>
                            {isPicked ? (
                              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary-foreground text-primary">
                                <Check className="size-3.5" strokeWidth={3} />
                              </span>
                            ) : (
                              <span className="size-5 shrink-0 rounded-full border-2 border-muted-foreground/40" />
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </Fragment>
                );
              })}
            </div>
            </div>
          </div>

          {/* The running total, and on a phone it rides the bottom of the screen
              as you scroll the grid: picking a slot two hours down the page and
              then hunting for the total is the one thing that made this feel
              like a web page rather than an app. It sits just above the tab bar,
              solid rather than frosted — floating over a grid of ticked cells,
              glass left the total competing with whatever scrolled under it. On
              a laptop the whole grid is in view, so it goes back to being the
              last block on the page. */}
          <div className="surface-raised sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 p-4 sm:p-5 md:static">
            {limitNote && (
              <p className="mb-4 flex items-start gap-2.5 rounded-2xl bg-primary/8 px-4 py-3.5 text-sm text-muted-foreground">
                <Info className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>{limitNote}</span>
              </p>
            )}

            {longestRun >= CALL_REQUIRED_HOURS && (
              <p className="mb-4 flex items-start gap-2.5 rounded-2xl bg-primary/8 px-4 py-3.5 text-sm text-muted-foreground">
                <Info className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>
                  {CALL_REQUIRED_HOURS}+ hours back to back on one court are held for {holdMinutes} minutes while you
                  call us to arrange payment — no reference number needed online.
                </span>
              </p>
            )}

            {runs.length > 1 && (
              <p className="mb-4 flex items-start gap-2.5 rounded-2xl bg-primary/8 px-4 py-3.5 text-sm text-muted-foreground">
                <Info className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>
                  Your picks aren&rsquo;t all back to back on one court, so they become {runs.length} separate
                  bookings — you&rsquo;ll pay for them together with one reference number (any run of{" "}
                  {CALL_REQUIRED_HOURS}+ hours is still arranged by phone instead).
                </span>
              </p>
            )}

            {state?.error && <p className="mb-3 text-sm text-destructive">{state.error}</p>}

            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground sm:text-xs">
                  Selected slots
                </p>
                <p className="data-value mt-1 text-lg font-bold sm:text-xl">
                  {selected.size === 0 ? "No slots yet" : `${selected.size} ${selected.size === 1 ? "Slot" : "Slots"}`}
                </p>
                {selected.size > 0 && (
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Total <span className="data-value font-bold text-foreground">{formatMoney(totalCents, currency)}</span>
                  </p>
                )}
              </div>

              {!signedIn ? (
                <SignInButton callbackUrl="/book" />
              ) : needsRegistration ? (
                <Link
                  href="/register?callbackUrl=/book"
                  className="btn btn-primary px-6 py-3"
                >
                  Complete profile
                </Link>
              ) : (
                <form action={formAction}>
                  <input type="hidden" name="slots" value={JSON.stringify(picks)} />
                  <input type="hidden" name="note" value={note} />
                  <button
                    type="submit"
                    disabled={pending || selected.size === 0}
                    className="btn btn-primary px-8 py-3"
                  >
                    {pending ? "Booking…" : "Confirm"}
                    {!pending && <Check className="size-4" />}
                  </button>
                </form>
              )}
            </div>

            {selected.size > 0 && signedIn && !needsRegistration && (
              <div className="mt-4">
                <label htmlFor="note" className="mb-1.5 block text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                  Note (optional)
                </label>
                <textarea
                  id="note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  className="field w-full"
                />
              </div>
            )}
          </div>
        </>
      )}

      {/* Last on Friday, so picking a slot never pushes the booking form below
          the notice — the thing you are doing stays above the thing you are
          reading. On Saturday it has already rendered, above the grid. */}
      {isSabbathDay && sabbathNoteAfterGrid && sabbathCard}
    </div>
  );
}
