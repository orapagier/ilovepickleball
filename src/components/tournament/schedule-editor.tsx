"use client";

import { useActionState, useCallback, useEffect, useState } from "react";
import { CalendarPlus, Pencil } from "lucide-react";
import {
  assignRoundToSession,
  deleteSession,
  saveSession,
  type ActionState,
} from "@/lib/actions/tournament-actions";
import { ActionButton } from "@/components/action-button";

export type SessionRow = {
  id: string;
  name: string;
  startAt: string;
  endAt: string;
  /** Preformatted for display; the raw dates stay on the server. */
  label: string;
  matchCount: number;
};

export type RoundRow = { round: number; matchCount: number; sessionId: string | null; played: number };

const INPUT = "field";
const QUIET =
  "rounded-full border border-border px-3 py-1 text-xs font-semibold text-foreground transition-colors hover:bg-accent disabled:opacity-50";
const DANGER =
  "rounded-full border border-destructive/40 px-3 py-1 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50";

/**
 * Building a schedule is two jobs, so this is two lists: the windows of play,
 * and which round goes in which window. Rounds are the unit because within one
 * round nobody plays twice — that's what makes a round fit in a window at all.
 *
 * A tournament with no windows runs as one continuous block, which is the
 * original behaviour and still the right answer for a one-morning event.
 */
export function ScheduleEditor({
  tournamentId,
  sessions,
  rounds,
  roundNoun,
  editable,
}: {
  tournamentId: string;
  sessions: SessionRow[];
  rounds: RoundRow[];
  /** "Round" for both formats, but the count differs — worth naming once. */
  roundNoun: string;
  editable: boolean;
}) {
  const [editing, setEditing] = useState<SessionRow | null>(null);
  const [adding, setAdding] = useState(false);
  // Stable identities so the child's close-on-success effect doesn't re-fire.
  const stopEditing = useCallback(() => setEditing(null), []);
  const stopAdding = useCallback(() => setAdding(false), []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {sessions.length === 0 && !adding && (
          <p className="surface-card p-4 text-sm text-muted-foreground">
            No windows yet, so this runs as one continuous block from the start time — the courts are held for as long
            as the draw is estimated to take. Add windows to spread play across mornings or days instead.
          </p>
        )}

        {sessions.map((session) =>
          editing?.id === session.id ? (
            <SessionForm
              key={session.id}
              tournamentId={tournamentId}
              session={session}
              onDone={stopEditing}
            />
          ) : (
            <div key={session.id} className="surface-card flex flex-wrap items-center justify-between gap-2 p-3.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{session.name}</p>
                <p className="text-xs text-muted-foreground">
                  {session.label} · {session.matchCount} {session.matchCount === 1 ? "match" : "matches"}
                </p>
              </div>
              {editable && (
                <div className="flex shrink-0 items-center gap-2">
                  <button type="button" onClick={() => setEditing(session)} className={QUIET}>
                    <Pencil className="mr-1 inline size-3" />
                    Edit
                  </button>
                  <ActionButton
                    action={() => deleteSession(session.id)}
                    confirmMessage={
                      session.matchCount > 0
                        ? `Remove "${session.name}"? Its ${session.matchCount} match(es) become unscheduled — they aren't deleted, they just stop being tied to a time.`
                        : `Remove "${session.name}"?`
                    }
                    pendingLabel="…"
                    className={DANGER}
                  >
                    Remove
                  </ActionButton>
                </div>
              )}
            </div>
          ),
        )}

        {editable &&
          (adding ? (
            <SessionForm tournamentId={tournamentId} session={null} onDone={stopAdding} />
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="flex items-center justify-center gap-1.5 rounded-md border border-dashed border-border px-4 py-3 text-sm font-medium text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
            >
              <CalendarPlus className="size-4" />
              Add a window
            </button>
          ))}
      </div>

      {rounds.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Which {roundNoun.toLowerCase()} plays when
          </h3>
          {sessions.length === 0 ? (
            <p className="text-xs text-muted-foreground">Add a window first, then assign rounds to it.</p>
          ) : (
            <ul className="surface-card divide-y divide-border">
              {rounds.map((round) => (
                <li key={round.round} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {roundNoun} {round.round}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {round.matchCount} {round.matchCount === 1 ? "match" : "matches"}
                      {round.played > 0 && ` · ${round.played} already played`}
                    </p>
                  </div>
                  <RoundAssign
                    tournamentId={tournamentId}
                    round={round.round}
                    sessions={sessions}
                    current={round.sessionId}
                    disabled={!editable}
                  />
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            Inside a window, matches are still called as courts free up — a window says which day and which hours,
            not which minute. Matches already played keep the window they were in.
          </p>
        </div>
      )}
    </div>
  );
}

function SessionForm({
  tournamentId,
  session,
  onDone,
}: {
  tournamentId: string;
  session: SessionRow | null;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(saveSession, {});

  // Close on success from an effect, not during render — collapsing the form
  // is a parent state change, and doing it mid-render is a React error.
  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);

  return (
    <form action={formAction} className="surface-card flex flex-col gap-3 p-3.5">
      <input type="hidden" name="tournamentId" value={tournamentId} />
      {session && <input type="hidden" name="sessionId" value={session.id} />}

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs font-medium text-muted-foreground">
          Name
          <input
            name="name"
            required
            defaultValue={session?.name ?? ""}
            placeholder="Round 1"
            className={`mt-1 ${INPUT}`}
          />
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          Starts
          <input
            name="startAt"
            type="datetime-local"
            required
            defaultValue={session?.startAt ?? ""}
            className={`mt-1 ${INPUT}`}
          />
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          Ends
          <input
            name="endAt"
            type="datetime-local"
            required
            defaultValue={session?.endAt ?? ""}
            className={`mt-1 ${INPUT}`}
          />
        </label>
      </div>

      {state?.error && <p className="text-xs text-destructive">{state.error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="btn btn-primary btn-sm"
        >
          {pending ? "Saving…" : session ? "Save window" : "Add window"}
        </button>
        <button type="button" onClick={onDone} className={QUIET}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Submits on change — one fewer click than a select plus a save button, and
 *  there's nothing to lose if it misfires since reassigning is free. */
function RoundAssign({
  tournamentId,
  round,
  sessions,
  current,
  disabled,
}: {
  tournamentId: string;
  round: number;
  sessions: SessionRow[];
  current: string | null;
  disabled: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(assignRoundToSession, {});

  return (
    <form action={formAction} className="flex shrink-0 items-center gap-2">
      <input type="hidden" name="tournamentId" value={tournamentId} />
      <input type="hidden" name="round" value={round} />
      <select
        name="sessionId"
        defaultValue={current ?? ""}
        disabled={disabled || pending}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="field field-sm"
      >
        <option value="">Unscheduled</option>
        {sessions.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} — {s.label}
          </option>
        ))}
      </select>
      {state?.error && <span className="text-xs text-destructive">{state.error}</span>}
    </form>
  );
}
