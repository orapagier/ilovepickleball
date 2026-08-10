import { prisma } from "@/lib/prisma";

/** How stale a display-only read may let an expired hold look. Writes that
 *  depend on the sweep for correctness pass `force` and ignore this. */
const REAP_INTERVAL_MS = 30_000;

let lastReapAtMs = 0;
let inFlight: Promise<void> | null = null;

/**
 * Vercel has no long-running process for a ticking sweep job, so expiry is
 * lazy and self-healing: call this at the top of every read/write path that
 * cares about slot occupancy (availability, booking creation, my-bookings,
 * the admin queue) to flip any stale holds to `expired` before reading.
 *
 * The two UPDATEs cost far more than a read (a write round trip to the primary,
 * and they run in series because the second would otherwise steal rows from the
 * first), which made them the bulk of the availability route's latency. So a
 * plain read only sweeps every `REAP_INTERVAL_MS`, and concurrent callers share
 * one in-flight sweep rather than each paying for their own. Anything whose
 * correctness depends on a fresh sweep — creating a booking, where a stale hold
 * would wrongly block a free slot — passes `force: true`.
 */
export async function reapExpiredBookings(opts?: { force?: boolean }): Promise<void> {
  if (inFlight) return inFlight;
  if (!opts?.force && Date.now() - lastReapAtMs < REAP_INTERVAL_MS) return;

  inFlight = sweep().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function sweep(): Promise<void> {
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

  // Stamped after the writes land, so a slow sweep can't let the next caller
  // through on a window that started before this one finished.
  lastReapAtMs = Date.now();
}
