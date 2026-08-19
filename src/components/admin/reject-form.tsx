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
        className="field field-sm"
      />
      <button
        type="submit"
        disabled={pending}
        title="Gives the customer 30 minutes to resubmit a corrected reference number, then auto-cancels."
        className="btn btn-danger btn-sm"
      >
        {pending ? "…" : "Invalid ref — 30 min to fix"}
      </button>
      {state?.error && <span className="text-xs text-destructive">{state.error}</span>}
    </form>
  );
}
