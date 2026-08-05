"use client";

import { ActionButton } from "@/components/action-button";
import { cancelBooking } from "@/lib/actions/booking-actions";

export function CancelButton({ bookingId }: { bookingId: string }) {
  return (
    <ActionButton
      action={() => cancelBooking(bookingId)}
      confirmMessage="Cancel this booking?"
      pendingLabel="Cancelling…"
      className="rounded-full border border-destructive/30 px-4 py-1.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-60"
    >
      Cancel booking
    </ActionButton>
  );
}
