"use client";

import { useActionState } from "react";
import { renameCourt, toggleCourt, type ActionState } from "@/lib/actions/admin-actions";
import { ActionButton } from "@/components/action-button";

export function CourtRow({ court }: { court: { id: number; name: string; active: boolean } }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(renameCourt, {});

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <form action={formAction} className="flex items-center gap-2">
        <input type="hidden" name="courtId" value={court.id} />
        <input
          name="name"
          defaultValue={court.name}
          className="rounded-lg border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          {pending ? "…" : "Rename"}
        </button>
      </form>

      <span
        className={`rounded-full px-3 py-1 text-xs font-medium ${
          court.active
            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
            : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
        }`}
      >
        {court.active ? "Active" : "Disabled"}
      </span>

      <ActionButton
        action={() => toggleCourt(court.id)}
        confirmMessage={court.active ? "Disable this court? It will stop showing up for booking." : undefined}
        className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        {court.active ? "Disable" : "Enable"}
      </ActionButton>

      {state?.error && <span className="text-xs text-red-600 dark:text-red-400">{state.error}</span>}
    </li>
  );
}
