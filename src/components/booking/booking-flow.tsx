"use client";

import { useEffect, useState, useActionState } from "react";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Info } from "lucide-react";
import { createBooking, type ActionState } from "@/lib/actions/booking-actions";
import { SignInButton } from "@/components/auth-buttons";
import { formatMoney, formatDateLabel, formatDateLabelShort } from "@/lib/format";
import { computeBookingPriceCents, type PriceTier } from "@/lib/pricing";
import { clampOffset, maxStripOffset, offsetForSelection } from "@/lib/date-strip";
import { cn } from "@/lib/utils";

const CALL_REQUIRED_HOURS = 4;
/** Date strip fits one line at every width — fewer cells on phones, more on desktop. */
const STRIP_DAYS_MOBILE = 5;
const STRIP_DAYS_DESKTOP = 7;

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

const SLOT_STATUS_LABEL: Record<SlotStatus, string> = {
  available: "Open",
  confirmed: "Booked",
  pending: "Pending Confirmation",
  past: "Past",
};

const LEGEND: { status: SlotStatus | "selected"; label: string; className: string }[] = [
  { status: "available", label: SLOT_STATUS_LABEL.available, className: "border border-border bg-card" },
  { status: "selected", label: "Selected", className: "bg-primary" },
  { status: "confirmed", label: SLOT_STATUS_LABEL.confirmed, className: "bg-success/70" },
  { status: "pending", label: SLOT_STATUS_LABEL.pending, className: "bg-warning/70" },
  { status: "past", label: SLOT_STATUS_LABEL.past, className: "bg-muted" },
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
  const [stripOffset, setStripOffset] = useState(0);
  const [stripDays, setStripDays] = useState(STRIP_DAYS_DESKTOP);
  const [slotsByCourt, setSlotsByCourt] = useState<Record<number, Slot[]>>({});
  const [loading, setLoading] = useState(true);
  const [maxHours, setMaxHours] = useState(6);
  const [slotDurationMin, setSlotDurationMin] = useState(initialSlotDurationMin);
  const [selectedCourtId, setSelectedCourtId] = useState<number | null>(null);
  const [selectedStartMs, setSelectedStartMs] = useState<number | null>(null);
  const [hours, setHours] = useState(1);
  const [note, setNote] = useState("");
  const [state, formAction, pending] = useActionState<ActionState, FormData>(createBooking, {});

  const totalAdvanceDays = daysBetweenISO(todayISO, maxISO);
  const maxOffset = maxStripOffset(totalAdvanceDays, stripDays);
  /** Clamped at render so a breakpoint change can't strand the window out of range. */
  const stripStart = clampOffset(stripOffset, maxOffset);
  const stripDates = Array.from({ length: stripDays }, (_, i) => addDaysISO(todayISO, stripStart + i)).filter(
    (d) => daysBetweenISO(todayISO, d) <= totalAdvanceDays,
  );

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const apply = () => setStripDays(mq.matches ? STRIP_DAYS_DESKTOP : STRIP_DAYS_MOBILE);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  function selectDate(d: string) {
    setDate(d);
    setSelectedCourtId(null);
    setSelectedStartMs(null);
    setLoading(true);
    const diff = daysBetweenISO(todayISO, d);
    setStripOffset((o) => offsetForSelection(diff, o, stripDays, maxOffset));
  }

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
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-3 py-6 sm:gap-6 sm:px-4 sm:py-8">
      {closedLabel && (
        <p className="flex items-start gap-2 rounded-lg border border-border bg-secondary/60 p-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0 text-primary" />
          <span>Closed weekly {closedLabel} — closed for Sabbath rest.</span>
        </p>
      )}

      <div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <label
            htmlFor="date-jump"
            className="flex shrink-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:text-sm"
          >
            <CalendarDays className="size-4 shrink-0" /> Choose a date
          </label>
          <input
            id="date-jump"
            type="date"
            min={todayISO}
            max={maxISO}
            value={date}
            onChange={(e) => e.target.value && selectDate(e.target.value)}
            className="h-8 shrink-0 rounded-lg border border-input bg-background px-2 text-xs sm:h-9 sm:px-3 sm:text-sm"
          />
          <p className="min-w-0 text-[11px] text-muted-foreground sm:text-xs">
            {/* The date itself is already in the picker alongside this, so it is the
                first thing dropped when the row runs out of phone width. */}
            <span className="sm:hidden">
              <span className="hidden min-[380px]:inline">{formatDateLabelShort(date)} · </span>
              {totalAdvanceDays} days ahead
            </span>
            <span className="hidden sm:inline">
              {formatDateLabel(date)} · book up to {totalAdvanceDays} days ahead
            </span>
          </p>
        </div>

        <div className="mt-2 flex items-stretch gap-1 rounded-xl border border-border bg-card p-1.5">
          <button
            type="button"
            onClick={() => setStripOffset(stripStart - 1)}
            disabled={stripStart <= 0}
            aria-label="Previous date"
            className="flex w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronLeft className="size-4" />
          </button>

          <div className="flex flex-1 gap-1">
            {stripDates.map((d) => {
              const dt = new Date(`${d}T00:00:00Z`);
              const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(dt);
              const day = new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: "UTC" }).format(dt);
              const month = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(dt);
              const selected = d === date;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => selectDate(d)}
                  aria-pressed={selected}
                  className={cn(
                    "flex min-w-0 flex-1 basis-0 flex-col items-center justify-center rounded-lg px-1 py-2 leading-tight transition-colors",
                    selected ? "bg-primary text-primary-foreground" : "hover:bg-accent",
                  )}
                >
                  <span className="text-[10px] font-medium uppercase tracking-wide opacity-70">{weekday}</span>
                  <span className="text-base font-semibold sm:text-lg">{day}</span>
                  <span
                    className={cn(
                      "text-[10px] uppercase tracking-wide",
                      selected ? "opacity-80" : "text-muted-foreground",
                    )}
                  >
                    {d === todayISO ? "Today" : month}
                  </span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setStripOffset(stripStart + 1)}
            disabled={stripStart >= maxOffset}
            aria-label="Next date"
            className="flex w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      <div>
        <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:gap-2 sm:text-sm">
          <Clock className="size-4 shrink-0" /> Start time
        </label>

        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground sm:text-xs">
          {LEGEND.map((item) => (
            <span key={item.status} className="flex items-center gap-1.5">
              <span className={cn("size-2.5 shrink-0 rounded-full", item.className)} />
              {item.label}
            </span>
          ))}
        </div>

        {loading ? (
          <p className="mt-3 text-sm text-muted-foreground">Loading availability…</p>
        ) : (
          <div className="mt-3 grid gap-4 md:grid-cols-2 md:gap-6">
            {courts.map((court) => {
              const courtSlots = (slotsByCourt[court.id] ?? []).filter((s) => s.date === date);
              return (
                <div key={court.id} className="surface-card p-3 sm:p-4">
                  <h3 className="text-base font-semibold">{court.name}</h3>
                  {courtSlots.length === 0 ? (
                    <p className="mt-3 text-sm text-muted-foreground">Closed this day.</p>
                  ) : (
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {courtSlots.map((s) => {
                        const selected = s.startMs === selectedStartMs && court.id === selectedCourtId;
                        return (
                          <button
                            key={s.startMs}
                            type="button"
                            disabled={!s.available}
                            onClick={() => {
                              setSelectedCourtId(court.id);
                              setSelectedStartMs(s.startMs);
                              setHours(1);
                            }}
                            className={cn(
                              "flex min-h-[3.75rem] flex-col items-center justify-center gap-0.5 rounded-lg border px-2 py-2.5 transition-colors",
                              selected
                                ? "border-primary bg-primary text-primary-foreground"
                                : s.status === "confirmed"
                                  ? "cursor-not-allowed border-success/30 bg-success/15 text-success"
                                  : s.status === "pending"
                                    ? "cursor-not-allowed border-warning/30 bg-warning/15 text-warning"
                                    : s.status === "past"
                                      ? "cursor-not-allowed border-transparent bg-muted text-muted-foreground/60"
                                      : "border-border bg-card hover:border-primary hover:bg-accent",
                            )}
                          >
                            <span className="text-sm font-semibold sm:text-base">{s.label}</span>
                            <span
                              className={cn(
                                "text-[10px] font-medium uppercase leading-tight tracking-wide",
                                !selected && s.status === "available" && "text-muted-foreground",
                              )}
                            >
                              {selected ? "Selected" : SLOT_STATUS_LABEL[s.status]}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

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
