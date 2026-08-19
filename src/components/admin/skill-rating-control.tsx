"use client";

import { useState, useTransition } from "react";
import { adminSetSkillRating } from "@/lib/actions/admin-actions";
import { SKILL_RATINGS } from "@/lib/skill";

/**
 * Staff correction for a member's self-declared rating. Saves on change rather
 * than behind a button: it is one field with no other state to keep in step, and
 * a save button next to a single select is a step that only exists to be
 * forgotten.
 */
export function SkillRatingControl({ userId, rating }: { userId: string; rating: number | null }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function save(raw: string) {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await adminSetSkillRating(userId, raw === "" ? null : Number(raw));
      if (res?.error) setError(res.error);
      else setSaved(true);
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <select
          aria-label="Skill rating"
          defaultValue={rating === null ? "" : String(rating)}
          disabled={pending}
          onChange={(e) => save(e.target.value)}
          className="field field-sm"
        >
          <option value="">Not rated</option>
          {SKILL_RATINGS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label} — {r.blurb}
            </option>
          ))}
        </select>
        {pending && <span className="text-xs text-muted-foreground">Saving…</span>}
        {!pending && saved && <span className="text-xs text-success">Saved</span>}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground">
        Decides which tournaments they can enter. Entries already accepted into a draw are not affected.
      </p>
    </div>
  );
}
