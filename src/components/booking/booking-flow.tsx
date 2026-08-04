"use client";

import { useEffect, useState, useActionState } from "react";
import { createBooking, type ActionState } from "@/lib/actions/booking-actions";
import { SignInButton } from "@/components/auth-buttons";
import { formatMoney, formatDateLabel } from "@/lib/format";

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
      <div className="flex gap-2">
        {courts.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => selectCourt(c.id)}
            className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              c.id === courtId
                ? "bg-emerald-600 text-white"
                : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            }`}
          >
            {c.name}
          </button>
        ))}
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-200">Date</label>
        <input
          type="date"
          min={todayISO}
          value={date}
          onChange={(e) => selectDate(e.target.value)}
          className="rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{formatDateLabel(date)}</p>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-200">Start time</label>
        {loading ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading availability…</p>
        ) : visibleSlots.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Closed this day.</p>
        ) : (
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {visibleSlots.map((s) => (
              <button
                key={s.startMs}
                type="button"
                disabled={!s.available}
                onClick={() => {
                  setSelectedStartMs(s.startMs);
                  setHours(1);
                }}
                className={`rounded-lg px-2 py-2 text-sm transition-colors ${
                  !s.available
                    ? "cursor-not-allowed bg-zinc-100 text-zinc-300 dark:bg-zinc-900 dark:text-zinc-700"
                    : s.startMs === selectedStartMs
                      ? "bg-emerald-600 text-white"
                      : "bg-zinc-100 text-zinc-700 hover:bg-emerald-100 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-emerald-900"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedStartMs !== null && (
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-200">
            Duration (hours)
          </label>
          <div className="flex gap-2">
            {Array.from({ length: maxDuration }, (_, i) => i + 1).map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setHours(h)}
                className={`h-10 w-10 rounded-full text-sm font-medium transition-colors ${
                  h === hours
                    ? "bg-emerald-600 text-white"
                    : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200"
                }`}
              >
                {h}
              </button>
            ))}
          </div>
          {hours >= 2 && (
            <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">
              Multi-hour bookings are held for {holdMinutes} minutes while you call us to arrange payment — no
              GCash reference needed online.
            </p>
          )}
          <p className="mt-2 text-sm font-medium text-zinc-700 dark:text-zinc-200">
            Total: {formatMoney(priceCentsPerHour * hours, currency)}
          </p>
        </div>
      )}

      {selectedStartMs !== null && (
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-200">
            Note (optional)
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
      )}

      {state?.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}

      {selectedStartMs !== null &&
        (signedIn ? (
          <form action={formAction}>
            <input type="hidden" name="courtId" value={courtId} />
            <input type="hidden" name="startMs" value={selectedStartMs} />
            <input type="hidden" name="hours" value={hours} />
            <input type="hidden" name="note" value={note} />
            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-full bg-emerald-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
            >
              {pending ? "Booking…" : "Reserve this slot"}
            </button>
          </form>
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-center dark:border-emerald-900 dark:bg-emerald-950">
            <p className="text-sm text-zinc-700 dark:text-zinc-200">Sign in to reserve this slot.</p>
            <SignInButton callbackUrl="/book" />
          </div>
        ))}
    </div>
  );
}
