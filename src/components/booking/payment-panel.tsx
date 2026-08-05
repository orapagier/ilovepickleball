"use client";

import { useActionState } from "react";
import { submitPayment, type ActionState } from "@/lib/actions/booking-actions";

export function PaymentPanel({ bookingId }: { bookingId: string }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(submitPayment, {});

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="bookingId" value={bookingId} />
      <label className="text-sm font-medium text-foreground">
        GCash reference number
        <input
          name="referenceNumber"
          required
          placeholder="e.g. 1234567890123"
          className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
        />
      </label>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-primary px-6 py-2 font-semibold text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Submitting…" : "I've paid — submit reference"}
      </button>
    </form>
  );
}
