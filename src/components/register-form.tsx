"use client";

import { useActionState } from "react";
import { completeRegistration, type ActionState } from "@/lib/actions/profile-actions";
import { SkillLevelPicker } from "@/components/skill-level-picker";

export function RegisterForm({
  defaultName,
  defaultPhone,
  defaultSkillRating,
  email,
  callbackUrl,
}: {
  defaultName: string;
  defaultPhone: string;
  defaultSkillRating: number | null;
  email: string;
  callbackUrl: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(completeRegistration, {});

  return (
    <form action={formAction} className="mt-6 flex flex-col gap-4">
      <input type="hidden" name="callbackUrl" value={callbackUrl} />

      <label className="text-sm font-bold text-foreground">
        Gmail
        <input
          value={email}
          disabled
          className="field mt-1 bg-secondary/50 text-muted-foreground w-full"
        />
      </label>

      <label className="text-sm font-bold text-foreground">
        Complete name
        <input
          name="name"
          required
          minLength={2}
          defaultValue={defaultName}
          placeholder="Juan Dela Cruz"
          className="field mt-1 w-full"
        />
      </label>

      <label className="text-sm font-bold text-foreground">
        Mobile number
        <input
          name="phone"
          required
          defaultValue={defaultPhone}
          placeholder="09171234567"
          className="field mt-1 w-full"
        />
      </label>

      {/* Not required, because this form gates booking a court and a rating has
          nothing to do with that — it is here only because a member is already
          filling in a form, and asking once beats asking later. It can be
          changed any time from /profile. */}
      <SkillLevelPicker defaultValue={defaultSkillRating} />

      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="btn btn-primary mt-2 w-full py-3"
      >
        {pending ? "Saving…" : "Save and continue"}
      </button>
    </form>
  );
}
