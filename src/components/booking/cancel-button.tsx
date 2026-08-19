"use client";

import { ActionButton } from "@/components/action-button";
import { cancelBooking } from "@/lib/actions/booking-actions";

export function CancelButton({ bookingId }: { bookingId: string }) {
  return (
    <ActionButton
      action={() => cancelBooking(bookingId)}
      confirmMessage="Cancel this booking?"
      pendingLabel="Cancelling…"
      className="btn btn-danger"
    >
      Cancel booking
    </ActionButton>
  );
}
