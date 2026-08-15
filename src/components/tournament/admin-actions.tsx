"use client";

import { useState } from "react";
import type { TournamentStatus } from "@/generated/prisma/enums";
import {
  adminWithdrawEntry,
  cancelTournament,
  closeRegistrationNow,
  deleteTournament,
  publishTournament,
  setEntryFeePaid,
  startPlay,
  type ActionState,
} from "@/lib/actions/tournament-actions";
import { tournamentDeletability } from "@/lib/tournament";
import { ActionButton } from "@/components/action-button";

const PRIMARY =
  "rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-50";
const DANGER =
  "rounded-full border border-destructive/40 px-5 py-2 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50";

/**
 * The one move a tournament can make from where it is, plus cancel. Only the
 * transition that's actually legal at this status is offered — the actions
 * themselves re-check, but an admin shouldn't be shown a button that will
 * only tell them no.
 */
export function TournamentAdminActions({
  tournamentId,
  status,
  completedAt,
  updatedAt,
}: {
  tournamentId: string;
  status: TournamentStatus;
  completedAt: Date | null;
  updatedAt: Date;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const deletion = tournamentDeletability({ status, completedAt, updatedAt });

  const report = (run: () => Promise<ActionState>) => async () => {
    const res = await run();
    setMessage(res.ok ? (res.message ?? "Done.") : null);
    return res;
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {status === "draft" && (
          <ActionButton
            action={report(() => publishTournament(tournamentId))}
            pendingLabel="Publishing…"
            className={PRIMARY}
          >
            Publish
          </ActionButton>
        )}

        {status === "registration_open" && (
          <ActionButton
            action={report(() => closeRegistrationNow(tournamentId))}
            confirmMessage="Close registration now and generate the draw? Entries below the minimum will cancel the tournament."
            pendingLabel="Drawing…"
            className={PRIMARY}
          >
            Close registration now
          </ActionButton>
        )}

        {status === "registration_closed" && (
          <ActionButton action={report(() => startPlay(tournamentId))} pendingLabel="Starting…" className={PRIMARY}>
            Start play
          </ActionButton>
        )}

        {status !== "completed" && status !== "cancelled" && (
          <ActionButton
            action={report(() => cancelTournament(tournamentId))}
            confirmMessage="Cancel this tournament? Every entry is withdrawn, fees are flagged for refund, and the courts go back on the calendar."
            pendingLabel="Cancelling…"
            className={DANGER}
          >
            Cancel tournament
          </ActionButton>
        )}

        {deletion.deletable && (
          <ActionButton
            action={() => deleteTournament(tournamentId)}
            confirmMessage="Delete this tournament for good? Its entries, matches, schedule and court blocks all go with it, and there is no undo. Export anything you still need first."
            pendingLabel="Deleting…"
            className={DANGER}
          >
            Delete tournament
          </ActionButton>
        )}
      </div>

      {/* A finished tournament inside the retention window gets the reason
          instead of a button, so the wait is visible rather than looking like
          the option was never there. Every other refusal is a dead end an
          admin can't act on, so it stays quiet. */}
      {!deletion.deletable && status === "completed" && (
        <p className="text-sm text-muted-foreground">{deletion.reason}</p>
      )}
      {message && <p className="text-sm text-success">{message}</p>}
    </div>
  );
}

const SMALL_QUIET =
  "rounded-full border border-border px-3 py-1 text-xs font-semibold text-foreground transition-colors hover:bg-accent disabled:opacity-50";
const SMALL_PRIMARY =
  "rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-50";
const SMALL_DANGER =
  "rounded-full border border-destructive/40 px-3 py-1 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50";

/** Withdraw an entry, or tick its fee as paid. Both are admin-only and both
 *  live on the same row, so they share one component. */
export function EntryAdminControls({
  registrationId,
  feePaid,
  hasFee,
  withdrawable,
}: {
  registrationId: string;
  feePaid: boolean;
  hasFee: boolean;
  withdrawable: boolean;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      {hasFee && (
        <ActionButton
          action={() => setEntryFeePaid(registrationId, !feePaid)}
          pendingLabel="…"
          className={feePaid ? SMALL_QUIET : SMALL_PRIMARY}
        >
          {feePaid ? "Fee paid" : "Mark fee paid"}
        </ActionButton>
      )}
      {withdrawable && (
        <ActionButton
          action={() => adminWithdrawEntry(registrationId)}
          confirmMessage="Withdraw this entry? If the draw is already made, their matches become walkovers."
          pendingLabel="…"
          className={SMALL_DANGER}
        >
          Withdraw
        </ActionButton>
      )}
    </div>
  );
}
