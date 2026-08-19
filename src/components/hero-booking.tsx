"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { createBooking, type ActionState } from "@/lib/actions/booking-actions";
import { dateStripParts } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The hero's booking card: day → court → hour, booked on the front page.
 *
 * It is real availability rather than an advertisement, which is what makes it
 * worth the space — a hero that says "book your court by the hour" says nothing
 * a member doesn't know, where a row of hours with two courts left in them says
 * "go now".
 *
 * It books, rather than handing the pick to `/book`: the same `createBooking`
 * the grid submits, one slot, which lands on that booking's payment step. The
 * grid is still there for anyone picking several hours at once.
 *
 * The court is chosen before the hour, not after, so the hours read as "is this
 * court free then" — the question somebody with a favourite court is asking.
 */
export type OpenHour = {
  startMs: number;
  label: string;
  /** Court ids still free in this hour. Its length is "3 free". */
  free: number[];
  /** Courts open at all in this hour, free or not. */
  courts: number;
};

export type HeroCourt = { id: number; name: string };

/** The same aggregate the homepage builds server-side for today, rebuilt on the
 *  client for any other day: one row per start time, across all courts. */
type ApiSlot = { date: string; startMs: number; label: string; available: boolean; status: string };

function aggregate(date: string, courtIds: number[], payloads: { slots?: ApiSlot[] }[]): OpenHour[] {
  const byStart = new Map<number, OpenHour>();
  payloads.forEach((payload, i) => {
    for (const s of payload.slots ?? []) {
      if (s.date !== date || s.status === "past") continue;
      const row = byStart.get(s.startMs) ?? { startMs: s.startMs, label: s.label, free: [], courts: 0 };
      row.courts += 1;
      if (s.available) row.free.push(courtIds[i]);
      byStart.set(s.startMs, row);
    }
  });
  return [...byStart.values()].sort((a, b) => a.startMs - b.startMs);
}

export function HeroBooking({
  courts,
  dates,
  initialHours,
  closedNote,
  rate,
  signedIn,
}: {
  courts: HeroCourt[];
  /** The bookable days this card offers, business-local, today first. */
  dates: string[];
  /** Today's hours, rendered on the server so the card is answered on arrival. */
  initialHours: OpenHour[];
  /** Why there are no hours, when there are none — a rest day, a blackout, or
   *  simply that today is done. */
  closedNote: string;
  rate: { symbol: string; amount: string };
  signedIn: boolean;
}) {
  const [date, setDate] = useState(dates[0]);
  /* `null` is "that day's check failed", which is a different fact from "no
     hours" and has to survive as its own state — the link to the database is a
     continent long and drops often enough that reporting a blip as a closed day
     is the card's most common lie. */
  const [byDate, setByDate] = useState<Record<string, OpenHour[] | null>>({ [dates[0]]: initialHours });
  const [picked, setPicked] = useState<number | null>(null);
  /* Court 1 by default: with two or three courts the choice is usually not one,
     and a card that opens with nothing selected asks a question before it
     answers any. It is a filter on the hours below, so it always shows. */
  const [courtId, setCourtId] = useState<number | null>(courts[0]?.id ?? null);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(createBooking, {});

  const hours = byDate[date];
  const loading = hours === undefined;
  const failed = hours === null;

  /* One fetch per court per day, cached by day — the same `/api/availability`
     the booking grid reads, so the hero and the grid cannot disagree. */
  useEffect(() => {
    // `in`, not truthiness: a failed day is remembered as null, and a falsy
    // check would refetch it on every render for as long as it kept failing.
    if (date in byDate) return;
    let cancelled = false;
    const ids = courts.map((c) => c.id);
    Promise.all(
      ids.map((id) =>
        fetch(`/api/availability?courtId=${id}&date=${date}`).then((r) => {
          // A 500 still parses as JSON, into an object with no `slots` — which
          // would read as a day with nothing open on it.
          if (!r.ok) throw new Error(`availability ${r.status}`);
          return r.json();
        }),
      ),
    )
      .then((payloads) => {
        if (!cancelled) setByDate((prev) => ({ ...prev, [date]: aggregate(date, ids, payloads) }));
      })
      .catch(() => {
        if (!cancelled) setByDate((prev) => ({ ...prev, [date]: null }));
      });
    return () => {
      cancelled = true;
    };
  }, [date, courts, byDate]);

  /** Free on the chosen court — the whole point of choosing one. */
  const openAt = (hour: OpenHour) => (courtId === null ? hour.free.length > 0 : hour.free.includes(courtId));

  const pickedHour = hours?.find((h) => h.startMs === picked) ?? null;
  const court = pickedHour && courtId !== null && pickedHour.free.includes(courtId) ? courtId : null;
  const courtName = courts.find((c) => c.id === court)?.name ?? null;
  /* Signed out, the pick travels to /signin and on to the grid with the day,
     hour and court already ticked — the booking itself needs an account. */
  const bookPath = `/book?date=${date}${pickedHour ? `&start=${pickedHour.startMs}` : ""}${
    court !== null ? `&court=${court}` : ""
  }`;

  function pickCourt(id: number) {
    setCourtId(id);
    // An hour that is taken on the court just chosen can't stay ticked.
    if (picked !== null && !hours?.find((h) => h.startMs === picked)?.free.includes(id)) setPicked(null);
  }

  const buttonLabel = pickedHour
    ? `Book ${courtName ?? ""} ${pickedHour.label}`.replace("  ", " ")
    : "Book a court";

  return (
    <div
      className="glass-on-dusk rise flex flex-col gap-4 p-4 sm:p-5"
      style={{ "--rise-delay": "260ms" } as React.CSSProperties}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="inline-flex items-center gap-2 text-sm font-bold">
          <span className="bloom-pulse size-2 rounded-full bg-bloom" />
          Open courts
        </p>
        <p className="text-xs text-dusk-foreground/60">
          <span className="figure-display text-base text-dusk-foreground">
            {rate.symbol}
            {rate.amount}
          </span>
          /hr · <span className="data-value text-dusk-foreground">{courts.length}</span>{" "}
          {courts.length === 1 ? "court" : "courts"}
        </p>
      </div>

      {/* Day first, the way the booking page asks it. A swipe strip rather than
          a fixed week, so the whole booking window is reachable from here
          instead of stopping at seven days. */}
      <div className="no-scrollbar -mx-1 flex snap-x gap-1 overflow-x-auto px-1">
        {dates.map((d, i) => {
          const { weekday, day } = dateStripParts(d);
          const active = d === date;
          return (
            <button
              key={d}
              type="button"
              onClick={() => {
                setDate(d);
                setPicked(null);
              }}
              aria-pressed={active}
              className={cn(
                "flex min-w-12 shrink-0 snap-start flex-col items-center rounded-xl px-2 py-1.5 text-center transition-colors",
                active ? "bg-dusk-foreground text-dusk" : "bg-white/10 text-dusk-foreground hover:bg-white/20",
              )}
            >
              <span className="text-[0.625rem] font-bold uppercase tracking-[0.04em] opacity-70">
                {i === 0 ? "Today" : weekday}
              </span>
              <span className="data-value text-sm leading-tight">{day}</span>
            </button>
          );
        })}
      </div>

      {/* Above the hours, because it decides what they say. */}
      {courts.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[0.625rem] font-bold uppercase tracking-[0.1em] text-dusk-foreground/60">
            Court
          </span>
          {courts.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => pickCourt(c.id)}
              aria-pressed={c.id === courtId}
              className={cn(
                "max-w-full truncate rounded-full px-3 py-1.5 text-xs font-bold transition-colors",
                c.id === courtId
                  ? "bg-dusk-foreground text-dusk"
                  : "bg-white/12 text-dusk-foreground hover:bg-white/20",
              )}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <p className="py-3 text-sm text-dusk-foreground/60">Checking the courts…</p>
      ) : failed ? (
        <p className="py-1 text-sm leading-relaxed text-dusk-foreground/75">
          Couldn&rsquo;t check that day — the courts didn&rsquo;t answer.{" "}
          <button
            type="button"
            onClick={() =>
              setByDate((prev) => {
                const next = { ...prev };
                delete next[date];
                return next;
              })
            }
            className="font-bold underline underline-offset-4"
          >
            Try again
          </button>
        </p>
      ) : hours.length === 0 ? (
        <p className="py-1 text-sm leading-relaxed text-dusk-foreground/75">
          {date === dates[0] ? closedNote : "Nothing open that day. Try another."}
        </p>
      ) : (
        <ul className="grid grid-cols-4 gap-1.5 sm:grid-cols-5">
          {hours.map((hour) => {
            const open = openAt(hour);
            const isPicked = hour.startMs === picked;
            return (
              <li key={hour.startMs} className="min-w-0">
                <button
                  type="button"
                  disabled={!open}
                  onClick={() => setPicked(isPicked ? null : hour.startMs)}
                  aria-pressed={isPicked}
                  className={cn(
                    "flex w-full flex-col items-center gap-0.5 rounded-xl px-1 py-2 text-center transition-colors",
                    !open
                      ? "cursor-not-allowed bg-white/5 text-dusk-foreground/40"
                      : isPicked
                        ? "bg-bloom text-bloom-foreground"
                        : "bg-white/12 text-dusk-foreground hover:bg-white/20",
                  )}
                >
                  <span className="figure-display w-full truncate text-[0.9rem] leading-tight">{hour.label}</span>
                  <span className="text-[0.625rem] font-bold uppercase tracking-[0.04em]">
                    {courtId === null ? (open ? `${hour.free.length} free` : "Full") : open ? "Open" : "Taken"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-white/12 pt-3.5">
        <p className="min-w-0 text-sm text-dusk-foreground/70">
          {state.error ? (
            <span className="text-bloom">{state.error}</span>
          ) : pickedHour ? (
            `${pickedHour.free.length} of ${pickedHour.courts} free at ${pickedHour.label}`
          ) : (
            "Pick an hour, we'll hold the court"
          )}
        </p>
        {signedIn ? (
          <form action={formAction}>
            <input
              type="hidden"
              name="slots"
              value={court !== null && pickedHour ? JSON.stringify([{ courtId: court, startMs: pickedHour.startMs }]) : "[]"}
            />
            <button type="submit" disabled={pending || court === null} className="btn btn-sm btn-primary">
              {pending ? "Holding…" : buttonLabel}
              {!pending && <ArrowRight className="size-3.5" />}
            </button>
          </form>
        ) : (
          <Link href={`/signin?callbackUrl=${encodeURIComponent(bookPath)}`} className="btn btn-sm btn-primary">
            {buttonLabel}
            <ArrowRight className="size-3.5" />
          </Link>
        )}
      </div>
    </div>
  );
}
