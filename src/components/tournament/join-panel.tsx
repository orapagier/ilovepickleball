"use client";

import { useActionState } from "react";
import { Info } from "lucide-react";
import { joinTournament, withdrawFromTournament, type ActionState } from "@/lib/actions/tournament-actions";
import Link from "next/link";
import { ActionButton } from "@/components/action-button";

/**
 * The one control a signed-in member needs on a tournament page: enter, or pull
 * out. Whether either is possible is settled on the server (`isJoinable` /
 * `canSelfWithdraw`) and handed down — this only renders it. The signed-out and
 * incomplete-profile cases are rendered by the page itself, so neither the
 * sign-in form nor its server action has to cross into the client bundle.
 */
/** Where the entry fee is sent. Only accounts that are actually configured are
 *  passed down — an empty one is worse than absent, since it reads as an
 *  instruction to pay nowhere. */
export type PayeeAccount = { label: string; name: string; number: string };

/**
 * Why this member can't enter on skill, decided on the server so the form is
 * never rendered to somebody who would only be refused by it. `band` is the
 * tournament's, `rating` is theirs.
 */
export type SkillBlock =
  | { reason: "unrated"; band: string }
  | { reason: "outside"; band: string; rating: string };

export function JoinPanel({
  tournamentId,
  isDoubles,
  entryStatus,
  joinable,
  withdrawable,
  entryFeeLabel,
  payeeAccounts,
  skillBlock,
}: {
  tournamentId: string;
  isDoubles: boolean;
  /** This member's own entry status, or null if they aren't in. */
  entryStatus: "registered" | "waitlisted" | "checked_in" | "no_show" | null;
  joinable: boolean;
  withdrawable: boolean;
  /** The fee as money, or null when this tournament is free — a fee is what
   *  makes the payment reference required. */
  entryFeeLabel: string | null;
  /** Where to send the fee. Empty when the club has configured no accounts. */
  payeeAccounts: PayeeAccount[];
  /** Set when this member's own rating bars them, null when it doesn't. A
   *  doubles partner is still only checked server-side — they're identified by
   *  an email typed into this form, so there is nothing to check until it is
   *  submitted. */
  skillBlock: SkillBlock | null;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(joinTournament, {});

  /* Name every way the club actually takes money, not just the first one — a
     field labelled "GCash ref" reads as GCash-only to someone who paid by bank
     transfer. Falls back to the full set when the club has configured no payee
     accounts, since the desk still takes all three. */
  const refSources =
    payeeAccounts.length > 0
      ? payeeAccounts.map((a) => a.label).join(" / ")
      : "GCash / BDO / QRPh";

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

  /* Neither case gets the form. That is the whole point: the entry fee is paid
     by hand, before anything here confirms it, so a member who can be refused
     after paying has already lost money. The refusal has to come before the
     reference field, not after it. */
  if (skillBlock) {
    /* Unrated is a thirty-second fix, so it points at the fix rather than just
       refusing — the member almost certainly does qualify. */
    if (skillBlock.reason === "unrated") {
      return (
        <div className="surface-card flex flex-col gap-3 p-4 sm:p-5">
          <div>
            <h3 className="font-semibold">Set your skill level to enter</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              This tournament is for {skillBlock.band} players, so we need your level before you can enter — and
              before you pay anything. Add it to your profile and you can enter straight away.
            </p>
          </div>
          <Link
            href="/profile"
            className="self-start rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90"
          >
            Set my skill level
          </Link>
        </div>
      );
    }

    /* Out of band is not fixable by the member, so this offers no control that
       looks like one. It says who to talk to instead, because the rating is
       self-declared and the honest answer to "that's wrong" is a person. */
    return (
      <div className="surface-card flex items-start gap-3 border-destructive/30 p-4 sm:p-5">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive/10">
          <Info className="size-4 text-destructive" />
        </span>
        <div>
          <h3 className="font-semibold">This one isn&rsquo;t for your level</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Entry is limited to {skillBlock.band} players and you&rsquo;re rated {skillBlock.rating}, so you
            can&rsquo;t enter this tournament — don&rsquo;t send any payment for it.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            If that rating is wrong, talk to the desk and they can correct it, or{" "}
            <Link href="/tournaments" className="font-medium text-primary hover:underline">
              find one at your level
            </Link>
            .
          </p>
        </div>
      </div>
    );
  }

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

      {entryFeeLabel && (
        <div>
          {/* Where the money goes, next to the field that asks for proof of
              sending it. Asking for a reference without saying where to pay is
              the one arrangement that guarantees a wrong answer. */}
          {payeeAccounts.length > 0 && (
            <div className="mb-3 rounded-lg border border-border bg-secondary/50 p-3 text-sm">
              <p className="text-muted-foreground">
                Send the {entryFeeLabel} entry fee to:
              </p>
              <ul className="mt-1.5 flex flex-col gap-1">
                {payeeAccounts.map((a) => (
                  <li key={a.label} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {a.label}
                    </span>
                    <strong>{a.name}</strong>
                    <span>{a.number}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                Pay to any one of these, then put the reference below.
              </p>
            </div>
          )}

          <label htmlFor="paymentReference" className="mb-1 block text-sm font-medium text-muted-foreground">
            Payment reference
          </label>
          <input
            id="paymentReference"
            name="paymentReference"
            required
            maxLength={60}
            placeholder={`${refSources} ref, or your mobile number`}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
          />
          {/* The desk settles fees by hand, so this is a thread to pull on
              rather than a verified payment — which is why a phone number is
              as good an answer as a transaction number. */}
          <p className="mt-1 text-xs text-muted-foreground">
            {payeeAccounts.length > 0
              ? `Put the reference from your ${refSources} transfer here, or your mobile number if you'd rather settle it at the desk`
              : `Entry is ${entryFeeLabel}. Put your ${refSources} reference here, or your mobile number if you'd rather arrange it with the desk`}
            {" "}— they&rsquo;ll confirm your payment before the draw.
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
