import type { BookingStatus } from "@/generated/prisma/enums";

/** Human-readable name for every `BookingStatus`, shared by the admin UI and
 *  the agent API so both describe a booking the same way. */
export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  pending_payment: "Pending payment",
  awaiting_confirmation: "Verifying payment",
  awaiting_call: "Awaiting call",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
  expired: "Expired",
};

/** As `BOOKING_STATUS_LABELS`, but a hold whose reference number the admin
 *  rejected reads as its own state — it's back in `pending_payment`, yet the
 *  customer is correcting a number rather than paying for the first time. */
export function bookingStatusLabel(b: { status: string; payment?: { status: string } | null }): string {
  if (b.status === "pending_payment" && b.payment?.status === "rejected") return "Fixing reference number";
  return BOOKING_STATUS_LABELS[b.status as BookingStatus] ?? b.status;
}
