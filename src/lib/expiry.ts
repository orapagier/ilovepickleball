import { prisma } from "@/lib/prisma";

/**
 * Vercel has no long-running process for a ticking sweep job, so expiry is
 * lazy and self-healing: call this at the top of every read/write path that
 * cares about slot occupancy (availability, booking creation, my-bookings,
 * the admin queue) to flip any stale holds to `expired` before reading.
 */
export async function reapExpiredBookings(): Promise<void> {
  await prisma.booking.updateMany({
    where: {
      status: { in: ["pending_payment", "awaiting_call"] },
      expiresAt: { lt: new Date() },
    },
    data: { status: "expired" },
  });
}
