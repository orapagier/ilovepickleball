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
        className="field w-full"
      />
      <button
        type="submit"
        disabled={pending}
        className="btn btn-primary"
      >
        {pending ? "Adding…" : "Add court"}
      </button>
      {state?.error && <span className="text-xs text-destructive">{state.error}</span>}
    </form>
  );
}
