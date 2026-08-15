"use client";

import { useState } from "react";
import { findSkillOption, SKILL_RATINGS } from "@/lib/skill";

/**
 * The skill field, wherever a member sets their own rating.
 *
 * It shows what the chosen level actually means rather than only its number,
 * because the rating is a self-assessment and the number alone invites a guess:
 * nobody knows whether they are a 3.0 or a 3.5 from the digits. The matrix rows
 * — what a player at this level can do, and what they are ready to enter — are
 * the assessment, so they are on screen while the choice is being made.
 *
 * That matters more here than in the admin control, where staff are correcting a
 * rating they have already formed a view about.
 */
export function SkillLevelPicker({
  defaultValue,
  name = "skillRating",
}: {
  defaultValue: number | null;
  /** The form field name, so a form can post it under whatever it calls it. */
  name?: string;
}) {
  const [value, setValue] = useState(defaultValue === null ? "" : String(defaultValue));
  const option = findSkillOption(value === "" ? null : Number(value));

  return (
    <div className="text-sm font-medium text-foreground">
      <label htmlFor={name}>Skill level</label>
      <select
        id={name}
        name={name}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
      >
        <option value="">I&rsquo;m not sure yet</option>
        {SKILL_RATINGS.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label} — {r.term}
          </option>
        ))}
      </select>

      {option ? (
        <div className="mt-2 rounded-lg border border-border bg-secondary/40 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            A {option.label} player
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs font-normal text-muted-foreground">
            {option.capabilities.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs font-normal text-foreground">{option.readiness}</p>
          {/* Said plainly, because the alternative is somebody picking the level
              they would like to be and finding out in a draw. */}
          <p className="mt-2 text-xs font-normal text-muted-foreground">
            Not quite you? Pick the level above or below and compare.
          </p>
        </div>
      ) : (
        /* The blank choice is a real answer, not an empty field, so it says what
           it costs — which is only entry to tournaments that set a band. */
        <p className="mt-1 text-xs font-normal text-muted-foreground">
          Leave this unset if you&rsquo;d rather not say. You can still book courts and enter any tournament that
          takes all levels.
        </p>
      )}

      <p className="mt-2 text-xs font-normal text-muted-foreground">
        Only used for tournament entry — tournaments can be limited to a range of levels. You can change this any
        time, and staff can correct it.
      </p>
    </div>
  );
}
