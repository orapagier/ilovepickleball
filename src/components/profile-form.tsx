"use client";

import { useActionState } from "react";
import { updateProfile, type ActionState } from "@/lib/actions/profile-actions";
import { SkillLevelPicker } from "@/components/skill-level-picker";

/**
 * The standing edit form for a member's own details.
 *
 * Distinct from `RegisterForm`, which is the gate before a first booking and so
 * ends in a redirect back to wherever the member was headed. This one is the
 * destination, so it stays put and confirms the save.
 */
export function ProfileForm({
  defaultName,
  defaultPhone,
  defaultSkillRating,
  email,
}: {
  defaultName: string;
  defaultPhone: string;
  defaultSkillRating: number | null;
  email: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(updateProfile, {});

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="text-sm font-medium text-foreground">
        Gmail
        <input
          value={email}
          disabled
          className="mt-1 w-full rounded-lg border border-input bg-secondary/50 px-3 py-2 text-sm text-muted-foreground"
        />
        {/* Sign-in identity, so it isn't ours to edit — changing it would be
            changing which account this is. */}
        <span className="mt-1 block text-xs font-normal text-muted-foreground">
          This is the account you sign in with, and how a doubles partner adds you to an entry.
        </span>
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

      <SkillLevelPicker defaultValue={defaultSkillRating} />

      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state?.ok && !state.error && <p className="text-sm text-success">Saved.</p>}

      <button
        type="submit"
        disabled={pending}
        className="mt-2 self-start rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}
