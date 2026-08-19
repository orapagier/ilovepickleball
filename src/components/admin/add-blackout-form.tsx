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
        className="field w-full"
      />
      <input
        name="reason"
        placeholder="Reason (optional)"
        className="field w-full"
      />
      <button
        type="submit"
        disabled={pending}
        className="btn btn-primary"
      >
        {pending ? "Adding…" : "Add blackout date"}
      </button>
      {state?.error && <span className="text-xs text-destructive">{state.error}</span>}
    </form>
  );
}
