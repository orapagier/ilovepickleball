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
          <div key={d} className="surface-card flex flex-wrap items-center gap-3 p-3">
            <span className="w-24 text-sm font-medium">{name}</span>
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              <input type="checkbox" name={`closed-${d}`} defaultChecked={closed} />
              Closed
            </label>
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              Opens
              <input
                type="time"
                name={`open-${d}`}
                defaultValue={row ? minutesToTime(row.openMin) : "00:00"}
                className="field field-sm"
              />
            </label>
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              Closes
              <input
                type="time"
                name={`close-${d}`}
                defaultValue={row ? minutesToTime(row.closeMin) : "00:00"}
                className="field field-sm"
              />
            </label>
          </div>
        );
      })}
      <p className="text-xs text-muted-foreground">
        A close time of 00:00 means &ldquo;open until midnight.&rdquo; Check &ldquo;Closed&rdquo; for a full day off.
      </p>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state?.ok && <p className="text-sm text-success">Saved.</p>}
      <button
        type="submit"
        disabled={pending}
        className="btn btn-primary w-fit"
      >
        {pending ? "Saving…" : "Save hours"}
      </button>
    </form>
  );
}
