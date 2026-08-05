"use client";

import { useActionState, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { updatePriceTiers, type ActionState } from "@/lib/actions/admin-actions";
import { minutesToTime } from "@/lib/format";

type Tier = { startMin: number; endMin: number; priceCentsPerHour: number };
type Row = Tier & { key: number };

const DEFAULT_TIER: Tier = { startMin: 480, endMin: 540, priceCentsPerHour: 20000 };

export function PricingForm({ tiers }: { tiers: Tier[] }) {
  const [rows, setRows] = useState<Row[]>(() =>
    tiers.length > 0 ? tiers.map((t, i) => ({ key: i, ...t })) : [{ key: 0, ...DEFAULT_TIER }],
  );
  // Only touched from event handlers (never during the render above) — refs must not be read/written while rendering.
  const nextKey = useRef(rows.length);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(updatePriceTiers, {});

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="tierCount" value={rows.length} />
      {rows.map((row, i) => (
        <div key={row.key} className="surface-card flex flex-wrap items-center gap-3 p-3">
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            From
            <input
              type="time"
              name={`start-${i}`}
              defaultValue={minutesToTime(row.startMin)}
              className="rounded border border-input bg-background px-2 py-1"
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            To
            <input
              type="time"
              name={`end-${i}`}
              defaultValue={minutesToTime(row.endMin)}
              className="rounded border border-input bg-background px-2 py-1"
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            ₱
            <input
              type="number"
              step="0.01"
              min="0"
              name={`price-${i}`}
              defaultValue={(row.priceCentsPerHour / 100).toFixed(2)}
              className="w-24 rounded border border-input bg-background px-2 py-1"
            />
            /hour
          </label>
          <button
            type="button"
            onClick={() => setRows((r) => r.filter((_, idx) => idx !== i))}
            aria-label="Remove tier"
            className="ml-auto rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={() => setRows((r) => [...r, { key: nextKey.current++, ...DEFAULT_TIER }])}
        className="w-fit rounded-full border border-border px-4 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
      >
        Add rate tier
      </button>

      <p className="text-xs text-muted-foreground">
        Each hour of a booking is billed at whichever tier its start time falls into. Hours outside every tier fall
        back to the flat rate set in Settings.
      </p>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state?.ok && <p className="text-sm text-success">Saved.</p>}
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-full bg-primary px-6 py-2 font-semibold text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save rates"}
      </button>
    </form>
  );
}
