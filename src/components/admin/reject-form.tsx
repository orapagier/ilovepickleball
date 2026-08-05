"use client";

import { useActionState } from "react";
import { rejectBooking, type ActionState } from "@/lib/actions/admin-actions";

export function RejectForm({ bookingId }: { bookingId: string }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(rejectBooking, {});

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="bookingId" value={bookingId} />
      <input
        name="reason"
        placeholder="Reason (optional)"
        className="rounded-lg border border-input bg-background px-2 py-1 text-sm"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-full border border-destructive/30 px-3 py-1.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-60"
      >
        {pending ? "…" : "Invalid ref → cash on-site"}
      </button>
      {state?.error && <span className="text-xs text-destructive">{state.error}</span>}
    </form>
  );
}
