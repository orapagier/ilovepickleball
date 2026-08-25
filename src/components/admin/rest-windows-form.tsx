"use client";

import { useActionState, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { updateRestWindows, type ActionState } from "@/lib/actions/admin-actions";
import { minutesToTime } from "@/lib/format";
import { restWindowSpanLabel, type RestWindowRow } from "@/lib/rest-windows";

/**
 * The club's weekly rests, in the admin's own words.
 *
 * This replaced a pair of constants in the source that fixed the rest at Friday
 * 5 PM → Saturday 6 PM, which only ever suited a seventh-day congregation. A
 * club that rests Sunday morning, keeps a midweek meeting, or never closes for
 * rest at all now says so here, and the booking grid, the homepage card and the
 * server's own validation all follow from these rows.
 *
 * Each window closes its time *over* the weekly hours: an admin does not also
 * have to edit Sunday's opening times to close Sunday morning.
 */
type Row = RestWindowRow & { key: number };

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Sunday morning, as a shape to edit rather than a suggestion to keep. */
const DEFAULT_WINDOW: Omit<RestWindowRow, "id"> = {
  startWeekday: 0,
  startMinute: 8 * 60,
  endWeekday: 0,
  endMinute: 12 * 60,
  label: "Rest",
  noteTitle: "",
  noteBody: "",
  quote: "",
  quoteSource: "",
};

const fieldSm = "field field-sm";

export function RestWindowsForm({ windows }: { windows: RestWindowRow[] }) {
  const [rows, setRows] = useState<Row[]>(() => windows.map((w, i) => ({ key: i, ...w })));
  // Only touched from event handlers, never while rendering.
  const nextKey = useRef(rows.length);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(updateRestWindows, {});

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="restCount" value={rows.length} />

      {rows.length === 0 && (
        <p className="surface-card p-4 text-sm text-muted-foreground">
          No weekly rest. The courts are bookable whenever the hours above say they are open.
        </p>
      )}

      {rows.map((row, i) => (
        <div key={row.key} className="surface-card flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              From
              <span className="flex gap-1.5">
                <select name={`restStartDay-${i}`} defaultValue={String(row.startWeekday)} className={fieldSm}>
                  {WEEKDAYS.map((name, d) => (
                    <option key={name} value={d}>
                      {name}
                    </option>
                  ))}
                </select>
                <input
                  type="time"
                  name={`restStartTime-${i}`}
                  defaultValue={minutesToTime(row.startMinute)}
                  className={fieldSm}
                />
              </span>
            </label>

            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              To
              <span className="flex gap-1.5">
                <select name={`restEndDay-${i}`} defaultValue={String(row.endWeekday)} className={fieldSm}>
                  {WEEKDAYS.map((name, d) => (
                    <option key={name} value={d}>
                      {name}
                    </option>
                  ))}
                </select>
                <input
                  type="time"
                  name={`restEndTime-${i}`}
                  defaultValue={minutesToTime(row.endMinute)}
                  className={fieldSm}
                />
              </span>
            </label>

            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Name on closed slots
              <input
                name={`restLabel-${i}`}
                defaultValue={row.label}
                placeholder="Sabbath"
                required
                className={fieldSm}
              />
            </label>

            <button
              type="button"
              onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
              aria-label="Remove this rest window"
              className="btn btn-sm btn-outline ml-auto"
            >
              <Trash2 className="size-4" />
            </button>
          </div>

          {/* The card members read on /book. Leaving the heading empty closes
              the time without putting a notice on the page. */}
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer font-bold">Note shown to members (optional)</summary>
            <div className="mt-3 flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                Heading
                <input
                  name={`restNoteTitle-${i}`}
                  defaultValue={row.noteTitle}
                  placeholder="Closed for the Sabbath"
                  className={fieldSm}
                />
              </label>
              <label className="flex flex-col gap-1">
                Explanation
                <textarea
                  name={`restNoteBody-${i}`}
                  defaultValue={row.noteBody}
                  rows={2}
                  placeholder="We keep the seventh day as a day of rest and worship."
                  className="field field-sm font-normal"
                />
                <span className="text-[0.6875rem]">
                  The times ({restWindowSpanLabel(row)}) are added automatically — no need to type them.
                </span>
              </label>
              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <label className="flex flex-col gap-1">
                  Quote
                  <textarea
                    name={`restQuote-${i}`}
                    defaultValue={row.quote}
                    rows={2}
                    className="field field-sm font-normal"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  Attribution
                  <input name={`restQuoteSource-${i}`} defaultValue={row.quoteSource} className={fieldSm} />
                </label>
              </div>
            </div>
          </details>
        </div>
      ))}

      <button
        type="button"
        onClick={() => {
          setRows((prev) => [...prev, { key: nextKey.current++, id: 0, ...DEFAULT_WINDOW }]);
        }}
        className="btn btn-sm btn-outline w-fit"
      >
        Add rest window
      </button>

      <p className="text-xs text-muted-foreground">
        A rest closes its hours even where the weekly hours above say the courts are open, and no booking can be
        made inside one. A window may run past midnight, or from one day into the next — set the end day after the
        start day and it carries over.
      </p>

      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state?.ok && <p className="text-sm text-success">Saved.</p>}

      <button type="submit" disabled={pending} className="btn btn-primary w-fit">
        {pending ? "Saving…" : "Save rest windows"}
      </button>
    </form>
  );
}
