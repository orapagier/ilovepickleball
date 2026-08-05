"use client";

import { useState, useActionState } from "react";
import { submitPayment, type ActionState } from "@/lib/actions/booking-actions";
import { cn } from "@/lib/utils";

type PayMethod = "gcash" | "bdo" | "qrph";

const METHODS: { value: PayMethod; label: string }[] = [
  { value: "gcash", label: "GCash" },
  { value: "bdo", label: "BDO" },
  { value: "qrph", label: "QRPh / InstaPay" },
];

export function PaymentPanel({
  bookingId,
  accounts,
}: {
  bookingId: string;
  accounts: Record<PayMethod, { name: string; number: string }>;
}) {
  const [method, setMethod] = useState<PayMethod>("gcash");
  const [state, formAction, pending] = useActionState<ActionState, FormData>(submitPayment, {});
  const account = accounts[method];

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="payMethod" value={method} />

      <div>
        <span className="text-sm font-medium text-foreground">Pay via</span>
        <div className="mt-1 flex flex-wrap gap-2">
          {METHODS.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setMethod(m.value)}
              className={cn(
                "rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                method === m.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-accent",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-secondary/50 p-3 text-sm">
        <p className="text-muted-foreground">Send payment to:</p>
        <p>
          <strong>{account.name || "(account name not set)"}</strong> — {account.number || "(account number not set)"}
        </p>
      </div>

      <label className="text-sm font-medium text-foreground">
        Reference number
        <input
          name="referenceNumber"
          required
          placeholder="e.g. 1234567890123"
          className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
        />
      </label>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-primary px-6 py-2 font-semibold text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Submitting…" : "I've paid — submit reference"}
      </button>
    </form>
  );
}
