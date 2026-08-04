"use client";

import { useActionState } from "react";
import { updateBusinessHours, type ActionState } from "@/lib/actions/admin-actions";
import { minutesToTime } from "@/lib/format";

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type Row = { weekday: number; openMin: number; closeMin: number };

export function HoursForm({ hours }: { hours: Row[] }) {
  const byDay = new Map(hours.map((h) => [h.weekday, h]));
  const [state, formAction, pending] = useActionState<ActionState, FormData>(updateBusinessHours, {});

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {WEEKDAY_NAMES.map((name, d) => {
        const row = byDay.get(d);
        const closed = !row || row.openMin === row.closeMin;
        return (
          <div
            key={d}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <span className="w-24 text-sm font-medium text-zinc-700 dark:text-zinc-200">{name}</span>
            <label className="flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-300">
              <input type="checkbox" name={`closed-${d}`} defaultChecked={closed} />
              Closed
            </label>
            <label className="flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-300">
              Opens
              <input
                type="time"
                name={`open-${d}`}
                defaultValue={row ? minutesToTime(row.openMin) : "00:00"}
                className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
            <label className="flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-300">
              Closes
              <input
                type="time"
                name={`close-${d}`}
                defaultValue={row ? minutesToTime(row.closeMin) : "00:00"}
                className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
          </div>
        );
      })}
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        A close time of 00:00 means &ldquo;open until midnight.&rdquo; Check &ldquo;Closed&rdquo; for a full day off.
      </p>
      {state?.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      {state?.ok && <p className="text-sm text-emerald-700 dark:text-emerald-400">Saved.</p>}
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-full bg-emerald-600 px-6 py-2 font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save hours"}
      </button>
    </form>
  );
}
