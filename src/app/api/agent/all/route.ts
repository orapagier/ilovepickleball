import type { NextRequest } from "next/server";
import { DateTime } from "luxon";
import { getSettings } from "@/lib/booking-data";
import { agentAuthFailure, agentJson, agentError } from "@/lib/agent-auth";
import { parseISODate, parseInteger, todayISO, MAX_AVAILABILITY_DAYS } from "@/lib/agent-api";
import {
  buildConfigPayload,
  buildAvailabilityPayload,
  buildBookingsPayload,
  buildSummaryPayload,
  resolveStatuses,
  DEFAULT_BOOKING_WINDOW_DAYS,
} from "@/lib/agent-payloads";

/**
 * GET /api/agent/all
 *
 * Every section of the agent API — config, summary, availability and bookings —
 * in one response, so an agent with a single HTTP tool can answer any question
 * without chaining calls or knowing which endpoint holds what.
 *
 * The defaults are tuned for a language model's context rather than for
 * completeness: a short availability window and no per-slot detail, since
 * `openRanges` already says what can be offered to a caller. Widen with `days`
 * and `slots=true` when the agent genuinely needs slot-level data — a 14-day,
 * all-slots response across several courts runs to hundreds of kilobytes.
 */

const SECTIONS = ["config", "summary", "availability", "bookings"] as const;
type Section = (typeof SECTIONS)[number];

/** Compact by default — see the note above about response size. */
const DEFAULT_AVAILABILITY_DAYS = 3;

function resolveSections(raw: string | null): Section[] | { error: string } {
  if (!raw?.trim()) return [...SECTIONS];

  const out = new Set<Section>();
  for (const part of raw.split(",")) {
    const key = part.trim().toLowerCase();
    if (!key) continue;
    if (key === "all") {
      for (const s of SECTIONS) out.add(s);
      continue;
    }
    if (!(SECTIONS as readonly string[]).includes(key)) {
      return { error: `Unknown section "${part.trim()}". Accepted: ${SECTIONS.join(", ")}, all.` };
    }
    out.add(key as Section);
  }
  return out.size > 0 ? [...out] : [...SECTIONS];
}

export async function GET(req: NextRequest) {
  const denied = agentAuthFailure(req);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const settings = await getSettings();
  const tz = settings.timezone;

  const sections = resolveSections(searchParams.get("include"));
  if ("error" in sections) return agentError(sections.error);

  const rawDate = searchParams.get("date");
  const dateISO = rawDate ? parseISODate(rawDate) : todayISO(tz);
  if (!dateISO) return agentError("`date` must be a valid YYYY-MM-DD date.");

  const statuses = resolveStatuses(searchParams.get("status"));
  if ("error" in statuses) return agentError(statuses.error);

  const rawCourt = searchParams.get("courtId");
  let courtId: number | null = null;
  if (rawCourt !== null) {
    courtId = Number(rawCourt);
    if (!Number.isInteger(courtId)) return agentError("`courtId` must be an integer.");
  }

  const days = parseInteger(searchParams.get("days"), DEFAULT_AVAILABILITY_DAYS, 1, MAX_AVAILABILITY_DAYS);
  // Bookings keep their own, longer horizon: knowing what's on the books three
  // weeks out costs a few rows, while three weeks of slots costs a payload.
  const bookingDays = parseInteger(searchParams.get("bookingDays"), DEFAULT_BOOKING_WINDOW_DAYS, 1, 365);
  const bookingToISO = DateTime.fromISO(dateISO, { zone: tz })
    .plus({ days: bookingDays - 1 })
    .toFormat("yyyy-LL-dd");

  const limit = parseInteger(searchParams.get("limit"), 100, 1, 200);
  const includeContact = searchParams.get("contact") === "true";
  const includeSlots = searchParams.get("slots") === "true";
  // Only meaningful alongside `slots=true`; defaults to trimming taken and
  // elapsed slots, which is what an agent offering times actually wants.
  const onlyAvailable = searchParams.get("onlyAvailable") !== "false";

  const want = (s: Section) => sections.includes(s);

  const [config, summary, availability, bookings] = await Promise.all([
    want("config") ? buildConfigPayload() : null,
    want("summary") ? buildSummaryPayload({ dateISO, includeContact }) : null,
    want("availability")
      ? buildAvailabilityPayload({ fromISO: dateISO, days, courtId, onlyAvailable, includeSlots })
      : null,
    want("bookings")
      ? buildBookingsPayload({ statuses, fromISO: dateISO, toISO: bookingToISO, courtId, limit, includeContact })
      : null,
  ]);

  if (courtId !== null && availability && availability.courts.length === 0) {
    return agentError(`No active court with id ${courtId}.`, 404);
  }

  return agentJson({
    generatedAtUtc: new Date().toISOString(),
    timezone: tz,
    currency: settings.currency,
    date: dateISO,
    nowLocal: DateTime.now().setZone(tz).toFormat("ccc, LLL d, yyyy, h:mm a"),
    included: sections,
    window: {
      availability: { from: dateISO, days },
      bookings: { from: dateISO, to: bookingToISO },
    },
    courtId,
    contactIncluded: includeContact,
    config,
    summary,
    availability,
    bookings,
  });
}
