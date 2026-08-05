"use client";

import { useActionState } from "react";
import { renameCourt, toggleCourt, type ActionState } from "@/lib/actions/admin-actions";
import { ActionButton } from "@/components/action-button";
import { cn } from "@/lib/utils";

export function CourtRow({ court }: { court: { id: number; name: string; active: boolean } }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(renameCourt, {});

  return (
    <li className="surface-card flex flex-wrap items-center gap-3 p-4">
      <form action={formAction} className="flex items-center gap-2">
        <input type="hidden" name="courtId" value={court.id} />
        <input
          name="name"
          defaultValue={court.name}
          className="rounded-lg border border-input bg-background px-2 py-1 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-full border border-border px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-60"
        >
          {pending ? "…" : "Rename"}
        </button>
      </form>

      <span
        className={cn(
          "rounded-full px-3 py-1 text-xs font-medium",
          court.active ? "bg-success/15 text-success" : "bg-secondary text-muted-foreground",
        )}
      >
        {court.active ? "Active" : "Disabled"}
      </span>

      <ActionButton
        action={() => toggleCourt(court.id)}
        confirmMessage={court.active ? "Disable this court? It will stop showing up for booking." : undefined}
        className="rounded-full border border-border px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent"
      >
        {court.active ? "Disable" : "Enable"}
      </ActionButton>

      {state?.error && <span className="text-xs text-destructive">{state.error}</span>}
    </li>
  );
}
