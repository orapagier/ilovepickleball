import { prisma } from "@/lib/prisma";

/**
 * Vercel has no long-running process for a ticking sweep job, so expiry is
 * lazy and self-healing: call this at the top of every read/write path that
 * cares about slot occupancy (availability, booking creation, my-bookings,
 * the admin queue) to flip any stale holds to `expired` before reading.
 */
export async function reapExpiredBookings(): Promise<void> {
  const now = new Date();

  // A reference number the admin flagged invalid gets a correction window
  // (see rejectBooking in admin-actions.ts): if it lapses without a
  // corrected resubmission, cancel the hold outright rather than lumping it
  // in with a plain expired hold.
  await prisma.booking.updateMany({
    where: {
      status: "pending_payment",
      expiresAt: { lt: now },
      payment: { status: "rejected" },
    },
    data: { status: "cancelled" },
  });

  await prisma.booking.updateMany({
    where: {
      status: { in: ["pending_payment", "awaiting_call"] },
      expiresAt: { lt: now },
    },
    data: { status: "expired" },
  });
}
