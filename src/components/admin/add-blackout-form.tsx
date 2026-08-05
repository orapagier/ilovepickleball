"use client";

import { useActionState, useRef, useEffect } from "react";
import { addBlackout, type ActionState } from "@/lib/actions/admin-actions";

export function AddBlackoutForm() {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(addBlackout, {});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-wrap items-center gap-2">
      <input
        type="date"
        name="date"
        required
        className="rounded-lg border border-input bg-background px-3 py-2 text-sm"
      />
      <input
        name="reason"
        placeholder="Reason (optional)"
        className="rounded-lg border border-input bg-background px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Adding…" : "Add blackout date"}
      </button>
      {state?.error && <span className="text-xs text-destructive">{state.error}</span>}
    </form>
  );
}
