"use client";

import { useActionState } from "react";
import { submitPayment, type ActionState } from "@/lib/actions/booking-actions";

export function PaymentPanel({ bookingId }: { bookingId: string }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(submitPayment, {});

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="bookingId" value={bookingId} />
      <label className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
        GCash reference number
        <input
          name="referenceNumber"
          required
          placeholder="e.g. 1234567890123"
          className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>
      {state?.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-emerald-600 px-6 py-2 font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
      >
        {pending ? "Submitting…" : "I've paid — submit reference"}
      </button>
    </form>
  );
}
