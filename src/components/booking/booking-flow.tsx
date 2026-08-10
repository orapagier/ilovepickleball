"use client";

import { Fragment, useEffect, useRef, useState, useActionState } from "react";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, Info } from "lucide-react";
import { createBooking, type ActionState } from "@/lib/actions/booking-actions";
import { SignInButton } from "@/components/auth-buttons";
import { formatMoney, formatMoneyCompact, formatDateLabel, formatMinuteOfDay, dateStripParts } from "@/lib/format";
import { computeBookingPriceCents, localMinuteOfDay, tierRateForMinute, type PriceTier } from "@/lib/pricing";
import { cn } from "@/lib/utils";

const CALL_REQUIRED_HOURS = 4;

type Court = { id: number; name: string };
type SlotStatus = "available" | "confirmed" | "pending" | "past";
type Slot = { date: string; startMs: number; label: string; available: boolean; status: SlotStatus };

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

/** "8-9 AM" / "11 AM-12 PM" — the meridiem is only repeated when it changes
 * mid-slot, which keeps the time column narrow on a phone. */
function slotRangeLabel(startMin: number, endMin: number): string {
  const start = formatMinuteOfDay(startMin);
  const end = formatMinuteOfDay(endMin);
  return start.slice(-2) === end.slice(-2) ? `${start.slice(0, -3)}-${end}` : `${start}-${end}`;
}

/** Day parts, matching how people talk about court times rather than any
 * business-hours boundary — a band is only rendered when it has slots. */
function dayPart(startMin: number): string {
  if (startMin < 360) return "Late night";
  if (startMin < 720) return "Morning";
  if (startMin < 1020) return "Afternoon";
  return "Evening";
}

const SLOT_STATUS_LABEL: Record<SlotStatus, string> = {
  available: "Open",
  confirmed: "Booked",
  pending: "Pending",
  past: "Past",
};

const LEGEND: { key: string; label: string; className: string }[] = [
  { key: "available", label: "Open", className: "border border-border bg-secondary" },
  { key: "selected", label: "Selected", className: "bg-primary" },
  { key: "confirmed", label: "Booked", className: "bg-success/70" },
  { key: "pending", label: "Pending confirmation", className: "bg-warning/70" },
  { key: "past", label: "Past", className: "bg-muted" },
];

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
}) {
  const [date, setDate] = useState(todayISO);
  const [slotsByCourt, setSlotsByCourt] = useState<Record<number, Slot[]>>({});
  const [loading, setLoading] = useState(true);
  const [maxHours, setMaxHours] = useState(6);
  const [slotDurationMin, setSlotDurationMin] = useState(initialSlotDurationMin);
  const [selectedCourtId, setSelectedCourtId] = useState<number | null>(null);
  const [selectedStartMs, setSelectedStartMs] = useState<number | null>(null);
  const [hours, setHours] = useState(1);
  const [note, setNote] = useState("");
  const [state, formAction, pending] = useActionState<ActionState, FormData>(createBooking, {});
  const stripRef = useRef<HTMLDivElement>(null);

  const totalAdvanceDays = daysBetweenISO(todayISO, maxISO);
  const stripDates = Array.from({ length: totalAdvanceDays + 1 }, (_, i) => addDaysISO(todayISO, i));

  function selectDate(d: string) {
    setDate(d);
    setSelectedCourtId(null);
    setSelectedStartMs(null);
    setLoading(true);
  }

  /* Pull the selected day back into view when the date changes from outside the
     strip — the header arrows and the calendar picker can both land on a day
     that has been scrolled well off the end. */
  useEffect(() => {
    stripRef.current
      ?.querySelector(`[data-date="${date}"]`)
      ?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [date]);

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
  }, [date, courts]);

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
    const rateCents = tierRateForMinute(startMin, tiers, priceCentsPerHour);
    return {
      startMs,
      part: dayPart(startMin),
      rangeLabel: slotRangeLabel(startMin, endMin),
      slotCents: Math.round((rateCents * slotDurationMin) / 60),
    };
  });

  const selectedCourtSlots = selectedCourtId !== null ? (slotsByCourt[selectedCourtId] ?? []) : [];
  const selectedCourtName = courts.find((c) => c.id === selectedCourtId)?.name ?? "";

  function contiguousAvailable(courtSlots: Slot[], startMs: number): number {
    const idx = courtSlots.findIndex((s) => s.startMs === startMs);
    if (idx === -1) return 0;
    let count = 0;
    for (let i = idx; i < courtSlots.length; i++) {
      const expectedStart = startMs + count * slotDurationMin * 60_000;
      if (courtSlots[i].startMs !== expectedStart || !courtSlots[i].available) break;
      count++;
      if (count >= maxHours) break;
    }
    return count;
  }

  const maxDuration =
    selectedStartMs !== null ? Math.max(contiguousAvailable(selectedCourtSlots, selectedStartMs), 1) : 1;
  const totalCents =
    selectedStartMs !== null
      ? computeBookingPriceCents({ startMs: selectedStartMs, hours, slotDurationMin, tz, tiers, fallbackCentsPerHour: priceCentsPerHour })
      : 0;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-3 py-6 sm:gap-5 sm:px-4 sm:py-8">
      {closedLabel && (
        <p className="flex items-start gap-2 rounded-lg border border-border bg-secondary/60 p-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0 text-primary" />
          <span>Closed weekly {closedLabel} — closed for Sabbath rest.</span>
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-bold sm:text-2xl">{formatDateLabel(date)}</h2>
          <p className="text-[11px] text-muted-foreground sm:text-xs">Book up to {totalAdvanceDays} days ahead</p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => selectDate(addDaysISO(date, -1))}
            disabled={date <= todayISO}
            aria-label="Previous day"
            className="flex size-10 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-card"
          >
            <ChevronLeft className="size-4" />
          </button>

          {/* The date input is stretched transparently over the icon so the whole
              square is the hit target; desktop browsers won't open the picker on
              a plain click, hence the explicit showPicker(). */}
          <div className="relative flex size-10 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground focus-within:ring-2 focus-within:ring-ring">
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
            className="flex size-10 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-card"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      {/* Every bookable day on one swipeable line, so picking a nearby date is a
          thumb-flick rather than a trip through the calendar picker. The
          negative margin lets cells scroll under the page padding to the screen
          edge; the scroll stays inside this box, so the page never widens. */}
      <div
        ref={stripRef}
        className="-mx-3 flex snap-x snap-mandatory gap-1.5 overflow-x-auto px-3 pb-1 sm:-mx-4 sm:gap-2 sm:px-4"
      >
        {stripDates.map((d) => {
          const { weekday, day, month } = dateStripParts(d);
          const selected = d === date;
          return (
            <button
              key={d}
              type="button"
              data-date={d}
              onClick={() => selectDate(d)}
              aria-pressed={selected}
              aria-label={formatDateLabel(d)}
              className={cn(
                "flex min-w-14 shrink-0 snap-start flex-col items-center gap-0.5 rounded-xl border px-2 py-2 transition-colors sm:min-w-16",
                selected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-foreground hover:border-primary hover:bg-accent",
                /* Today keeps a faint ring so the strip still reads as "starts
                   here" once it has been scrolled away from the left edge. */
                !selected && d === todayISO && "ring-1 ring-primary/40",
              )}
            >
              {/* Opacity rather than a muted token, so the two small lines stay
                  legible against the filled background of the selected cell. */}
              <span className="text-[10px] font-semibold uppercase tracking-wide opacity-70">{weekday}</span>
              <span className="text-base font-bold leading-none sm:text-lg">{day}</span>
              <span className="text-[10px] uppercase opacity-70">{month}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground sm:text-xs">
        {LEGEND.map((item) => (
          <span key={item.key} className="flex items-center gap-1.5">
            <span className={cn("size-2.5 shrink-0 rounded-full", item.className)} />
            {item.label}
          </span>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading availability…</p>
      ) : rows.length === 0 ? (
        <p className="surface-card p-6 text-center text-sm text-muted-foreground">Closed this day.</p>
      ) : (
        <div className="surface-card overflow-x-auto">
          {/* The grid fills the card rather than sizing to its content, so two
              courts stay side by side on a phone instead of pushing the time
              column off-screen. Columns only stop shrinking at their minimums
              (the `--*-col` vars, widened from `sm` up), and the card scrolls
              horizontally past that — i.e. once there are too many courts. */}
          <div
            className="grid min-w-full [--court-col:4rem] [--time-col:4.25rem] sm:[--court-col:5.5rem] sm:[--time-col:6rem]"
            style={{
              gridTemplateColumns: `minmax(var(--time-col), auto) repeat(${courts.length}, minmax(var(--court-col), 1fr))`,
            }}
          >
            <div className="border-b border-r border-border bg-secondary/60 px-1.5 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:px-2 sm:py-3 sm:text-xs">
              Time
            </div>
            {courts.map((court) => (
              <div
                key={court.id}
                className="flex items-center justify-center border-b border-border bg-secondary/60 px-1.5 py-2.5 text-center text-[11px] font-semibold leading-tight text-balance sm:px-2 sm:py-3 sm:text-sm"
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
                  {showBand && (
                    <div className="col-span-full border-b border-border bg-secondary/60 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:px-3 sm:text-xs">
                      {row.part}
                    </div>
                  )}

                  <div
                    className={cn(
                      "flex flex-col justify-center border-r border-border bg-secondary/25 px-1.5 py-2 leading-tight sm:px-2",
                      rule,
                    )}
                  >
                    {/* Nowrap keeps "11 AM-12 PM" on one line; the `auto` track
                        widens to fit it rather than the label wrapping. */}
                    <span className="whitespace-nowrap text-[11px] font-medium sm:text-sm">{row.rangeLabel}</span>
                    <span className="whitespace-nowrap text-[11px] font-bold text-primary sm:text-sm">
                      {formatMoneyCompact(row.slotCents, currency)}
                    </span>
                  </div>

                  {courts.map((court) => {
                    const slot = slotByCourtAndStart.get(court.id)?.get(row.startMs);
                    const selected = slot?.startMs === selectedStartMs && court.id === selectedCourtId;
                    const status = slot?.status;
                    const label = selected ? "Selected" : status ? SLOT_STATUS_LABEL[status] : "Closed";
                    return (
                      <div key={court.id} className={cn("flex p-1 sm:p-1.5", rule)}>
                        <button
                          type="button"
                          disabled={!slot?.available}
                          onClick={() => {
                            setSelectedCourtId(court.id);
                            setSelectedStartMs(row.startMs);
                            setHours(1);
                          }}
                          aria-label={`${court.name}, ${row.rangeLabel}, ${label}`}
                          className={cn(
                            "flex h-full min-h-11 w-full items-center justify-center rounded-lg border px-1 text-[10px] font-semibold uppercase tracking-wide transition-colors",
                            selected
                              ? "border-primary bg-primary text-primary-foreground"
                              : status === "confirmed"
                                ? "cursor-not-allowed border-success/30 bg-success/15 text-success"
                                : status === "pending"
                                  ? "cursor-not-allowed border-warning/30 bg-warning/15 text-warning"
                                  : status === "available"
                                    ? "border-border bg-secondary/70 text-muted-foreground hover:border-primary hover:bg-accent hover:text-foreground"
                                    : "cursor-not-allowed border-transparent bg-muted text-muted-foreground/60",
                          )}
                        >
                          {label}
                        </button>
                      </div>
                    );
                  })}
                </Fragment>
              );
            })}
          </div>
        </div>
      )}

      {selectedStartMs !== null && selectedCourtId !== null && (
        <div className="surface-card p-4 sm:p-5">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:text-sm">
            {selectedCourtName} · Duration (hours)
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            {Array.from({ length: maxDuration }, (_, i) => i + 1).map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setHours(h)}
                className={cn(
                  "flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-medium transition-colors",
                  h === hours
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-accent",
                )}
              >
                {h}
              </button>
            ))}
          </div>
          {hours >= CALL_REQUIRED_HOURS && (
            <p className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-secondary/60 p-3 text-sm text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>
                Bookings of {CALL_REQUIRED_HOURS}+ hours are held for {holdMinutes} minutes while you call us to
                arrange payment — no reference number needed online.
              </span>
            </p>
          )}
          <p className="mt-4 text-lg font-semibold">Total: {formatMoney(totalCents, currency)}</p>

          <div className="mt-4">
            <label htmlFor="note" className="mb-1 block text-sm font-medium text-muted-foreground">
              Note (optional)
            </label>
            <textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
            />
          </div>

          {state?.error && <p className="mt-3 text-sm text-destructive">{state.error}</p>}

          <div className="mt-5">
            {!signedIn ? (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-secondary/60 p-4 text-center">
                <p className="text-sm text-muted-foreground">Sign in to reserve this slot.</p>
                <SignInButton callbackUrl="/book" />
              </div>
            ) : needsRegistration ? (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-secondary/60 p-4 text-center">
                <p className="text-sm text-muted-foreground">
                  Complete your profile (name &amp; mobile number) to reserve this slot.
                </p>
                <Link
                  href="/register?callbackUrl=/book"
                  className="rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90"
                >
                  Complete profile
                </Link>
              </div>
            ) : (
              <form action={formAction}>
                <input type="hidden" name="courtId" value={selectedCourtId} />
                <input type="hidden" name="startMs" value={selectedStartMs} />
                <input type="hidden" name="hours" value={hours} />
                <input type="hidden" name="note" value={note} />
                <button
                  type="submit"
                  disabled={pending}
                  className="w-full rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-60"
                >
                  {pending ? "Booking…" : "Reserve this slot"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
