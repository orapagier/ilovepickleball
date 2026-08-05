"use client";

import { useEffect, useState, useActionState } from "react";
import { CalendarDays, Clock, Info } from "lucide-react";
import { createBooking, type ActionState } from "@/lib/actions/booking-actions";
import { SignInButton } from "@/components/auth-buttons";
import { formatMoney, formatDateLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

type Court = { id: number; name: string };
type Slot = { date: string; startMs: number; label: string; available: boolean };

export function BookingFlow({
  courts,
  todayISO,
  priceCentsPerHour,
  currency,
  holdMinutes,
  signedIn,
}: {
  courts: Court[];
  todayISO: string;
  priceCentsPerHour: number;
  currency: string;
  holdMinutes: number;
  signedIn: boolean;
}) {
  const [courtId, setCourtId] = useState(courts[0]?.id ?? 0);
  const [date, setDate] = useState(todayISO);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [maxHours, setMaxHours] = useState(6);
  const [slotDurationMin, setSlotDurationMin] = useState(60);
  const [selectedStartMs, setSelectedStartMs] = useState<number | null>(null);
  const [hours, setHours] = useState(1);
  const [note, setNote] = useState("");
  const [state, formAction, pending] = useActionState<ActionState, FormData>(createBooking, {});

  function selectCourt(id: number) {
    setCourtId(id);
    setSelectedStartMs(null);
    setLoading(true);
  }

  function selectDate(d: string) {
    setDate(d);
    setSelectedStartMs(null);
    setLoading(true);
  }

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/availability?courtId=${courtId}&date=${date}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setSlots(data.slots ?? []);
        setMaxHours(data.maxHours ?? 6);
        setSlotDurationMin(data.slotDurationMin ?? 60);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [courtId, date]);

  const visibleSlots = slots.filter((s) => s.date === date);

  function contiguousAvailable(startMs: number): number {
    const idx = slots.findIndex((s) => s.startMs === startMs);
    if (idx === -1) return 0;
    let count = 0;
    for (let i = idx; i < slots.length; i++) {
      const expectedStart = startMs + count * slotDurationMin * 60_000;
      if (slots[i].startMs !== expectedStart || !slots[i].available) break;
      count++;
      if (count >= maxHours) break;
    }
    return count;
  }

  const maxDuration = selectedStartMs !== null ? Math.max(contiguousAvailable(selectedStartMs), 1) : 1;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-wrap gap-2">
        {courts.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => selectCourt(c.id)}
            className={cn(
              "rounded-full px-4 py-2 text-sm font-medium transition-colors",
              c.id === courtId
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-accent",
            )}
          >
            {c.name}
          </button>
        ))}
      </div>

      <div>
        <label className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <CalendarDays className="size-4" /> Date
        </label>
        <input
          type="date"
          min={todayISO}
          value={date}
          onChange={(e) => selectDate(e.target.value)}
          className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
        />
        <p className="mt-1 text-xs text-muted-foreground">{formatDateLabel(date)}</p>
      </div>

      <div>
        <label className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <Clock className="size-4" /> Start time
        </label>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading availability…</p>
        ) : visibleSlots.length === 0 ? (
          <p className="text-sm text-muted-foreground">Closed this day.</p>
        ) : (
          <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6">
            {visibleSlots.map((s) => (
              <button
                key={s.startMs}
                type="button"
                disabled={!s.available}
                onClick={() => {
                  setSelectedStartMs(s.startMs);
                  setHours(1);
                }}
                className={cn(
                  "rounded-lg border px-2 py-2 text-sm font-medium transition-colors",
                  !s.available
                    ? "cursor-not-allowed border-transparent bg-muted text-muted-foreground/60"
                    : s.startMs === selectedStartMs
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card hover:border-primary hover:bg-accent",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedStartMs !== null && (
        <div className="surface-card p-5">
          <label className="mb-1 block text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Duration (hours)
          </label>
          <div className="mt-2 flex gap-2">
            {Array.from({ length: maxDuration }, (_, i) => i + 1).map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setHours(h)}
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-full text-sm font-medium transition-colors",
                  h === hours
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-accent",
                )}
              >
                {h}
              </button>
            ))}
          </div>
          {hours >= 2 && (
            <p className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-secondary/60 p-3 text-sm text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>
                Multi-hour bookings are held for {holdMinutes} minutes while you call us to arrange payment — no
                GCash reference needed online.
              </span>
            </p>
          )}
          <p className="mt-4 text-lg font-semibold">Total: {formatMoney(priceCentsPerHour * hours, currency)}</p>

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
            {signedIn ? (
              <form action={formAction}>
                <input type="hidden" name="courtId" value={courtId} />
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
            ) : (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-secondary/60 p-4 text-center">
                <p className="text-sm text-muted-foreground">Sign in to reserve this slot.</p>
                <SignInButton callbackUrl="/book" />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
