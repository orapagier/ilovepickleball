"use client";

import { useState, useTransition } from "react";
import { cancelBooking } from "@/lib/actions/booking-actions";

export function CancelButton({ bookingId }: { bookingId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!confirm("Cancel this booking?")) return;
          setError(null);
          startTransition(async () => {
            const res = await cancelBooking(bookingId);
            if (res.error) setError(res.error);
          });
        }}
        className="rounded-full border border-red-300 px-4 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-60 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
      >
        {pending ? "Cancelling…" : "Cancel booking"}
      </button>
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
