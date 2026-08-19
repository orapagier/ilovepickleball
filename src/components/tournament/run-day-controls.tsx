"use client";

import { useActionState } from "react";
import {
  assignMatchCourt,
  completeMatch,
  recordWalkover,
  type ActionState,
} from "@/lib/actions/tournament-actions";

/**
 * The three things staff do to a match on the day: record the score, call a
 * no-show, or put a queued match on a specific court by hand. Everything else
 * about the running order happens on its own as courts free up.
 */

export function RecordScoreForm({
  matchId,
  sideA,
  sideB,
}: {
  matchId: string;
  sideA: { registrationId: string; name: string };
  sideB: { registrationId: string; name: string };
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(completeMatch, {});

  return (
    <form action={formAction} className="flex flex-col gap-2.5">
      <input type="hidden" name="matchId" value={matchId} />

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Winner
        </legend>
        {[sideA, sideB].map((side) => (
          <label
            key={side.registrationId}
            className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm has-checked:border-primary has-checked:bg-primary/10"
          >
            <input
              type="radio"
              name="winnerRegistrationId"
              value={side.registrationId}
              required
              className="size-4 accent-current"
            />
            <span className="truncate">{side.name}</span>
          </label>
        ))}
      </fieldset>

      <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Score
        <input
          name="score"
          required
          placeholder="11-7, 11-9"
          className="field mt-1 font-normal normal-case tracking-normal text-foreground w-full"
        />
      </label>

      {state?.error && <p className="text-xs text-destructive">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="btn btn-primary"
      >
        {pending ? "Recording…" : "Record result"}
      </button>
    </form>
  );
}

/** A no-show before the match starts: it completes without ever taking a
 *  court, and the opponent advances straight away. */
export function WalkoverForm({
  matchId,
  sideAName,
  sideBName,
}: {
  matchId: string;
  sideAName: string;
  sideBName: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(recordWalkover, {});

  return (
    <form action={formAction} className="flex flex-col gap-1.5">
      <input type="hidden" name="matchId" value={matchId} />
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">No-show</p>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="submit"
          name="noShowSide"
          value="A"
          disabled={pending}
          className="btn btn-outline btn-sm text-muted-foreground"
        >
          {sideAName}
        </button>
        <button
          type="submit"
          name="noShowSide"
          value="B"
          disabled={pending}
          className="btn btn-outline btn-sm text-muted-foreground"
        >
          {sideBName}
        </button>
      </div>
      {state?.error && <p className="text-xs text-destructive">{state.error}</p>}
    </form>
  );
}

/** Manual override of the queue — for when the desk wants a particular match
 *  on a particular court regardless of the order it came up in. */
export function AssignCourtForm({
  matchId,
  courts,
}: {
  matchId: string;
  courts: { id: number; name: string }[];
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(assignMatchCourt, {});

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-1.5">
      <input type="hidden" name="matchId" value={matchId} />
      {courts.map((court) => (
        <button
          key={court.id}
          type="submit"
          name="courtId"
          value={court.id}
          disabled={pending}
          className="btn btn-outline btn-sm text-muted-foreground"
        >
          Send to {court.name}
        </button>
      ))}
      {state?.error && <p className="w-full text-xs text-destructive">{state.error}</p>}
    </form>
  );
}
