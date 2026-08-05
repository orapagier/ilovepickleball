"use client";

import { useEffect, useState, useActionState } from "react";
import { rescheduleBooking, type ActionState } from "@/lib/actions/admin-actions";
import { cn } from "@/lib/utils";

type Court = { id: number; name: string };
type Slot = { date: string; startMs: number; label: string; available: boolean };

export function RescheduleControl({
  bookingId,
  courts,
  currentCourtId,
  todayISO,
}: {
  bookingId: string;
  courts: Court[];
  currentCourtId: number;
  todayISO: string;
}) {
  const [open, setOpen] = useState(false);
  const [courtId, setCourtId] = useState(currentCourtId);
  const [date, setDate] = useState(todayISO);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedStartMs, setSelectedStartMs] = useState<number | null>(null);
  const [hours, setHours] = useState(1);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(rescheduleBooking, {});

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch(`/api/availability?courtId=${courtId}&date=${date}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setSlots(data.slots ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, courtId, date]);

  if (state?.ok && open) {
    setOpen(false);
    setSelectedStartMs(null);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setLoading(true);
          setOpen(true);
        }}
        className="rounded-full border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
      >
        Reschedule
      </button>
    );
  }

  const visibleSlots = slots.filter((s) => s.date === date);

  return (
    <form
      action={formAction}
      className="mt-3 flex w-full flex-col gap-3 rounded-lg border border-border bg-secondary/40 p-3"
    >
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="courtId" value={courtId} />
      <input type="hidden" name="startMs" value={selectedStartMs ?? ""} />
      <input type="hidden" name="hours" value={hours} />

      <div className="flex flex-wrap gap-2">
        {courts.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => {
              setCourtId(c.id);
              setSelectedStartMs(null);
            }}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-colors",
              c.id === courtId
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-accent",
            )}
          >
            {c.name}
          </button>
        ))}
      </div>

      <input
        type="date"
        min={todayISO}
        value={date}
        onChange={(e) => {
          setDate(e.target.value);
          setSelectedStartMs(null);
        }}
        className="h-9 w-fit rounded-lg border border-input bg-background px-3 text-sm"
      />

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading availability…</p>
      ) : visibleSlots.length === 0 ? (
        <p className="text-sm text-muted-foreground">Closed this day.</p>
      ) : (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
          {visibleSlots.map((s) => (
            <button
              key={s.startMs}
              type="button"
              disabled={!s.available}
              onClick={() => setSelectedStartMs(s.startMs)}
              className={cn(
                "rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors",
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

      {selectedStartMs !== null && (
        <div className="flex items-center gap-2">
          <label htmlFor={`hours-${bookingId}`} className="text-xs font-medium text-muted-foreground">
            Hours
          </label>
          <select
            id={`hours-${bookingId}`}
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            className="rounded-lg border border-input bg-background px-2 py-1 text-sm"
          >
            {Array.from({ length: 6 }, (_, i) => i + 1).map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </div>
      )}

      {state?.error && <p className="text-xs text-destructive">{state.error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending || selectedStartMs === null}
          className="rounded-full bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Confirm new time"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-full border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
