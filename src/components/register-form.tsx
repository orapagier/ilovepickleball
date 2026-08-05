"use client";

import { useActionState } from "react";
import { completeRegistration, type ActionState } from "@/lib/actions/profile-actions";

export function RegisterForm({
  defaultName,
  defaultPhone,
  email,
  callbackUrl,
}: {
  defaultName: string;
  defaultPhone: string;
  email: string;
  callbackUrl: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(completeRegistration, {});

  return (
    <form action={formAction} className="mt-6 flex flex-col gap-4">
      <input type="hidden" name="callbackUrl" value={callbackUrl} />

      <label className="text-sm font-medium text-foreground">
        Gmail
        <input
          value={email}
          disabled
          className="mt-1 w-full rounded-lg border border-input bg-secondary/50 px-3 py-2 text-sm text-muted-foreground"
        />
      </label>

      <label className="text-sm font-medium text-foreground">
        Complete name
        <input
          name="name"
          required
          minLength={2}
          defaultValue={defaultName}
          placeholder="Juan Dela Cruz"
          className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
        />
      </label>

      <label className="text-sm font-medium text-foreground">
        Mobile number
        <input
          name="phone"
          required
          defaultValue={defaultPhone}
          placeholder="09171234567"
          className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
        />
      </label>

      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="mt-2 w-full rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save and continue"}
      </button>
    </form>
  );
}
