import { after } from "next/server";
import type { BookingStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { getGoogleAccessToken, getGoogleCredentials } from "@/lib/google-auth";
import { PAY_METHOD_LABELS } from "@/lib/pay-method";
import { bookingStatusLabel } from "@/lib/booking-status";

/**
 * Mirrors bookings into Google Calendar — one calendar per court, mapped by
 * `Court.googleCalendarId`.
 *
 * Three rules hold everywhere in this file:
 *
 *  1. It is a mirror, never a source of truth. Nothing here is read back into
 *     the booking system; an event edited by hand in Google is overwritten on
 *     the next sync of that booking.
 *  2. It never breaks a booking. Every entry point swallows its errors, so a
 *     Google outage, a revoked key, or an unshared calendar degrades to "the
 *     calendar is stale" instead of "customers can't book".
 *  3. It is idempotent and self-healing. State lives in `Booking.googleEventId`,
 *     and `reconcileCalendar` sweeps up anything a failed call left behind.
 */

const SCOPE = "https://www.googleapis.com/auth/calendar.events";
const API = "https://www.googleapis.com/calendar/v3/calendars";

/** Statuses that should have an event on the calendar at all. */
const LIVE_STATUSES: BookingStatus[] = ["pending_payment", "awaiting_confirmation", "awaiting_call", "confirmed"];
/** Google's graphite; marks a hold apart from the default-coloured real thing. */
const PENDING_COLOR_ID = "8";
/** Cap on how many strays one reconcile pass cleans up, so a big backlog can't stall a request. */
const RECONCILE_BATCH = 25;

export function isCalendarSyncConfigured(): boolean {
  return getGoogleCredentials() !== null;
}

type BookingForSync = {
  id: string;
  status: string;
  hours: number;
  startUtc: Date;
  endUtc: Date;
  payMethod: string | null;
  customerNote: string;
  googleEventId: string;
  court: { name: string; googleCalendarId: string };
  customer: { name: string; email: string; phone: string };
  payment: { status: string; referenceNumber: string } | null;
};

async function call(
  path: string,
  init: { method: string; body?: unknown; query?: Record<string, string> },
): Promise<Response | null> {
  const token = await getGoogleAccessToken(SCOPE);
  if (!token) return null;
  const qs = init.query ? `?${new URLSearchParams(init.query)}` : "";
  return fetch(`${API}/${path}${qs}`, {
    method: init.method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
}

function eventBody(b: BookingForSync, timezone: string) {
  const confirmed = b.status === "confirmed";
  const who = b.customer.name || b.customer.email;
  const lines = [
    `Status: ${bookingStatusLabel(b)}`,
    `Customer: ${who}`,
    b.customer.phone ? `Mobile: ${b.customer.phone}` : "",
    `Email: ${b.customer.email}`,
    b.payMethod ? `Payment: ${PAY_METHOD_LABELS[b.payMethod as keyof typeof PAY_METHOD_LABELS] ?? b.payMethod}` : "",
    b.payment?.referenceNumber ? `Reference: ${b.payment.referenceNumber}` : "",
    b.customerNote ? `Note: ${b.customerNote}` : "",
    "",
    `Booking id: ${b.id}`,
  ].filter(Boolean);

  return {
    // The prefix does the work that Google's "tentative" styling is too subtle
    // to do on a phone screen at a glance.
    summary: confirmed ? `${who} (${b.hours}h)` : `PENDING — ${who} (${b.hours}h)`,
    description: lines.join("\n"),
    start: { dateTime: b.startUtc.toISOString(), timeZone: timezone },
    end: { dateTime: b.endUtc.toISOString(), timeZone: timezone },
    status: confirmed ? "confirmed" : "tentative",
    colorId: confirmed ? undefined : PENDING_COLOR_ID,
    // Lets a lost googleEventId be recovered by searching the calendar, and
    // marks the event as ours so a human-made event is never touched.
    extendedProperties: { private: { bookingId: b.id } },
  };
}

async function deleteEvent(calendarId: string, eventId: string): Promise<void> {
  const res = await call(`${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
  });
  // 404/410 mean it's already gone, which is the state we wanted anyway.
  if (res && !res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`Calendar delete failed (${res.status}): ${await res.text()}`);
  }
}

/**
 * Brings the calendar in line with one booking's current state: creates the
 * event, updates it, moves it between court calendars, or removes it.
 *
 * Safe to call for any booking at any time — it works out what's needed.
 */
async function syncBooking(bookingId: string): Promise<void> {
  if (!isCalendarSyncConfigured()) return;

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      status: true,
      hours: true,
      startUtc: true,
      endUtc: true,
      payMethod: true,
      customerNote: true,
      googleEventId: true,
      court: { select: { name: true, googleCalendarId: true } },
      customer: { select: { name: true, email: true, phone: true } },
      payment: { select: { status: true, referenceNumber: true } },
    },
  });
  if (!booking) return;

  const calendarId = booking.court.googleCalendarId.trim();
  const shouldExist = LIVE_STATUSES.includes(booking.status) && calendarId !== "";

  if (!shouldExist) {
    if (!booking.googleEventId) return;
    // The event may live on a calendar the booking has since moved off, but
    // deleting by the booking's current calendar covers every case except a
    // court that was remapped mid-hold — rare, and reconcile can't fix it
    // either, so accept the stray rather than storing a second column.
    if (calendarId) await deleteEvent(calendarId, booking.googleEventId);
    await prisma.booking.update({ where: { id: booking.id }, data: { googleEventId: "" } });
    return;
  }

  // Read straight from the table rather than via booking-data's getSettings:
  // that module imports the expiry sweep, which imports this one, and the
  // resulting cycle is only ever a TDZ error waiting for a refactor.
  const settings = await prisma.setting.findUnique({ where: { id: 1 }, select: { timezone: true } });
  const body = eventBody(booking as BookingForSync, settings?.timezone ?? "Asia/Manila");

  if (booking.googleEventId) {
    const res = await call(`${encodeURIComponent(calendarId)}/events/${encodeURIComponent(booking.googleEventId)}`, {
      method: "PATCH",
      body,
    });
    if (res?.ok) return;
    // Gone from this calendar — either deleted by hand or the booking was
    // rescheduled onto a different court. Fall through and create it fresh.
    if (res && res.status !== 404 && res.status !== 410) {
      throw new Error(`Calendar update failed (${res.status}): ${await res.text()}`);
    }
  }

  const res = await call(`${encodeURIComponent(calendarId)}/events`, { method: "POST", body });
  if (!res) return;
  if (!res.ok) throw new Error(`Calendar create failed (${res.status}): ${await res.text()}`);
  const created = (await res.json()) as { id: string };
  await prisma.booking.update({ where: { id: booking.id }, data: { googleEventId: created.id } });
}

/**
 * Runs `work` after the response is sent. `after` hands the promise to
 * Vercel's waitUntil, which is what stops the serverless invocation from being
 * frozen mid-request with the Google call half-finished; the bare-promise
 * fallback covers any caller outside a request context.
 */
function detach(label: string, work: () => Promise<void>): void {
  const guarded = () =>
    work().catch((err) => {
      console.error(`[calendar] ${label}:`, err);
    });
  try {
    after(guarded);
  } catch {
    void guarded();
  }
}

/**
 * Queues the mirror for one booking. Callers never await it — a booking is
 * saved whether or not Google is reachable — so failures are logged, not
 * surfaced to the customer.
 */
export function queueCalendarSync(bookingId: string): void {
  if (!isCalendarSyncConfigured()) return;
  detach(`sync failed for booking ${bookingId}`, () => syncBooking(bookingId));
}

/**
 * Removes an event for a booking row that is about to disappear, so the delete
 * can be awaited *before* the row (and its event id) is gone.
 */
export async function removeCalendarEvent(calendarId: string, eventId: string): Promise<void> {
  if (!isCalendarSyncConfigured() || !calendarId || !eventId) return;
  try {
    await deleteEvent(calendarId, eventId);
  } catch (err) {
    console.error(`[calendar] delete failed for event ${eventId}:`, err);
  }
}

/**
 * Clears events left behind by bookings that died without a successful sync —
 * chiefly holds flipped to `expired` by the lazy sweep, which updates in bulk
 * and so never sees individual rows.
 *
 * Fire-and-forget by design: if the serverless invocation ends first, the next
 * sweep picks up where this left off.
 */
export function reconcileCalendar(): void {
  if (!isCalendarSyncConfigured()) return;
  detach("reconcile failed", async () => {
    const strays = await prisma.booking.findMany({
      where: { status: { notIn: LIVE_STATUSES }, googleEventId: { not: "" } },
      select: { id: true, googleEventId: true, court: { select: { googleCalendarId: true } } },
      take: RECONCILE_BATCH,
    });
    for (const s of strays) {
      if (s.court.googleCalendarId) await deleteEvent(s.court.googleCalendarId, s.googleEventId);
      await prisma.booking.update({ where: { id: s.id }, data: { googleEventId: "" } });
    }
  });
}
