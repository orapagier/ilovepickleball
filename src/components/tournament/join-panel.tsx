"use client";

import { useActionState } from "react";
import { joinTournament, withdrawFromTournament, type ActionState } from "@/lib/actions/tournament-actions";
import { ActionButton } from "@/components/action-button";

/**
 * The one control a signed-in member needs on a tournament page: enter, or pull
 * out. Whether either is possible is settled on the server (`isJoinable` /
 * `canSelfWithdraw`) and handed down — this only renders it. The signed-out and
 * incomplete-profile cases are rendered by the page itself, so neither the
 * sign-in form nor its server action has to cross into the client bundle.
 */
export function JoinPanel({
  tournamentId,
  isDoubles,
  entryStatus,
  joinable,
  withdrawable,
}: {
  tournamentId: string;
  isDoubles: boolean;
  /** This member's own entry status, or null if they aren't in. */
  entryStatus: "registered" | "waitlisted" | "checked_in" | "no_show" | null;
  joinable: boolean;
  withdrawable: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(joinTournament, {});

  if (entryStatus) {
    return (
      <div className="surface-card flex flex-col gap-3 p-4 sm:p-5">
        <div>
          <h3 className="font-semibold">
            {entryStatus === "waitlisted" ? "You're on the waitlist" : "You're entered"}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {entryStatus === "waitlisted"
              ? "The draw is full. If an entry withdraws before registration closes, you move up automatically."
              : "We'll post the draw here as soon as registration closes."}
          </p>
        </div>
        {withdrawable ? (
          <ActionButton
            action={() => withdrawFromTournament(tournamentId)}
            confirmMessage="Withdraw your entry from this tournament?"
            pendingLabel="Withdrawing…"
            className="self-start rounded-full border border-border px-5 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-accent"
          >
            Withdraw
          </ActionButton>
        ) : (
          <p className="text-xs text-muted-foreground">
            Registration has closed, so withdrawing is an admin action now — talk to the desk.
          </p>
        )}
      </div>
    );
  }

  if (!joinable) return null;

  return (
    <form action={formAction} className="surface-card flex flex-col gap-3 p-4 sm:p-5">
      <input type="hidden" name="tournamentId" value={tournamentId} />
      <h3 className="font-semibold">Enter this tournament</h3>

      {isDoubles && (
        <div>
          <label htmlFor="partnerEmail" className="mb-1 block text-sm font-medium text-muted-foreground">
            Partner&rsquo;s email
          </label>
          <input
            id="partnerEmail"
            name="partnerEmail"
            type="email"
            required
            placeholder="partner@example.com"
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
          />
          {/* No invite/accept step in v1: entering names your partner outright,
              so they need an account already and should know it's happening. */}
          <p className="mt-1 text-xs text-muted-foreground">
            They need to have signed in here at least once. Both of you are entered straight away — check with them
            first.
          </p>
        </div>
      )}

      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state?.ok && state.message && <p className="text-sm text-success">{state.message}</p>}

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Entering…" : "Enter"}
      </button>
    </form>
  );
}
