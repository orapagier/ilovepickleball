import type { NextRequest } from "next/server";
import { DateTime } from "luxon";
import { prisma } from "@/lib/prisma";
import { getSettings, getBusinessHours, getActiveCourts, getPriceTiers } from "@/lib/booking-data";
import { agentAuthFailure, agentJson } from "@/lib/agent-auth";
import { todayISO } from "@/lib/agent-api";
import { BOOKING_STATUS_LABELS } from "@/lib/booking-status";
import { summarizeHours, closedWindowLabel } from "@/lib/hours-summary";
import { formatMinuteOfDay, formatMoney } from "@/lib/format";
import { PAY_METHOD_LABELS } from "@/lib/pay-method";
import { MAX_ADVANCE_DAYS, MAX_BOOKING_HOURS } from "@/lib/scheduling";

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * GET /api/agent/config
 * Everything an agent needs to interpret the other endpoints: who the business
 * is, which courts exist, when it's open, what an hour costs, and how a
 * customer can pay. Nothing here is per-customer data.
 */
export async function GET(req: NextRequest) {
  const denied = agentAuthFailure(req);
  if (denied) return denied;

  const [settings, hours, courts, tiers] = await Promise.all([
    getSettings(),
    getBusinessHours(),
    getActiveCourts(),
    getPriceTiers(),
  ]);

  const tz = settings.timezone;
  const today = todayISO(tz);
  // Past closures are noise for an agent answering "can I book on X".
  const blackouts = await prisma.blackoutDate.findMany({
    where: { date: { gte: new Date(`${today}T00:00:00Z`) } },
    orderBy: { date: "asc" },
    take: 100,
  });

  const closed = closedWindowLabel(hours);

  return agentJson({
    business: {
      name: settings.businessName,
      contactPerson: settings.contactPerson,
      contactPhone: settings.contactPhone,
      contactEmail: settings.contactEmail,
      address: settings.address,
      timezone: tz,
      currency: settings.currency,
      today,
      nowLocal: DateTime.now().setZone(tz).toFormat("ccc, LLL d, yyyy, h:mm a"),
    },
    bookingRules: {
      slotDurationMin: settings.slotDurationMin,
      maxBookingHours: MAX_BOOKING_HOURS,
      maxAdvanceDays: MAX_ADVANCE_DAYS,
      /** A slot starting sooner than this many minutes from now can't be booked online. */
      leadMinutes: settings.leadMinutes,
      /** How long an unpaid hold survives before the sweep expires it. */
      holdMinutes: settings.holdMinutes,
    },
    courts: courts.map((c) => ({ id: c.id, name: c.name })),
    hours: {
      summary: summarizeHours(hours),
      weeklyClosure: closed,
      byWeekday: hours.map((h) => ({
        weekday: h.weekday,
        day: WEEKDAY_NAMES[h.weekday] ?? String(h.weekday),
        openMin: h.openMin,
        closeMin: h.closeMin,
        opens: formatMinuteOfDay(h.openMin),
        closes: formatMinuteOfDay(h.closeMin),
      })),
    },
    pricing: {
      defaultCentsPerHour: settings.priceCentsPerHour,
      defaultFormatted: formatMoney(settings.priceCentsPerHour, settings.currency),
      // A tier with a `weekday` beats an every-day tier covering the same minute.
      tiers: tiers.map((t) => ({
        startMin: t.startMin,
        endMin: t.endMin,
        window: `${formatMinuteOfDay(t.startMin)} – ${formatMinuteOfDay(t.endMin)}`,
        weekday: t.weekday,
        day: t.weekday == null ? "every day" : (WEEKDAY_NAMES[t.weekday] ?? String(t.weekday)),
        centsPerHour: t.priceCentsPerHour,
        formatted: formatMoney(t.priceCentsPerHour, settings.currency),
      })),
    },
    payment: {
      methods: PAY_METHOD_LABELS,
      gcash: { name: settings.gcashName, number: settings.gcashNumber },
      bdo: { accountName: settings.bdoAccountName, accountNumber: settings.bdoAccountNumber },
      qrph: { accountName: settings.qrphAccountName, accountNumber: settings.qrphAccountNumber },
    },
    upcomingClosures: blackouts.map((b) => ({
      date: b.date.toISOString().slice(0, 10),
      reason: b.reason,
    })),
    bookingStatuses: BOOKING_STATUS_LABELS,
  });
}
