"use client";

import { useActionState, useRef, useEffect } from "react";
import { addCourt, type ActionState } from "@/lib/actions/admin-actions";

export function AddCourtForm() {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(addCourt, {});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="flex items-center gap-2">
      <input
        name="name"
        placeholder="e.g. Court 3"
        required
        className="rounded-lg border border-input bg-background px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Adding…" : "Add court"}
      </button>
      {state?.error && <span className="text-xs text-destructive">{state.error}</span>}
    </form>
  );
}
