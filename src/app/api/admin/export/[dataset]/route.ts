import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth-helpers";
import { getSettings, getPriceTiers } from "@/lib/booking-data";
import { computeBookingPriceCents } from "@/lib/pricing";
import { PAY_METHOD_LABELS } from "@/lib/pay-method";
import { BOOKING_STATUS_LABELS, bookingStatusLabel } from "@/lib/booking-status";
import { rangeUtcBounds } from "@/lib/scheduling";
import { csvDateTime, csvMoney, csvResponse, fileStamp, toCsv, type CsvColumn } from "@/lib/csv";
import { entryName } from "@/lib/tournament-data";
import { FORMAT_LABELS, PLAY_TYPE_LABELS, TOURNAMENT_STATUS_LABELS } from "@/lib/tournament";

/**
 * GET /api/admin/export/<dataset>.csv
 *
 * Admin-only spreadsheet exports. A route handler rather than a server action
 * because the browser has to receive a file: an action returns data to React,
 * which can't become a download without shipping the whole dataset to the
 * client first.
 *
 * Datasets: `bookings`, `tournaments`, `entries`, `matches`.
 * Optional filters: `from`/`to` (YYYY-MM-DD) and `status` on bookings,
 * `tournamentId` on the three tournament datasets.
 *
 * The filters mirror the ones on the admin pages that link here, so an export
 * button hands back the rows the admin is looking at rather than everything.
 */

const DATASETS = ["bookings", "tournaments", "entries", "matches"] as const;
type Dataset = (typeof DATASETS)[number];

/** Bounded so one request can't try to serialise the entire history at once. */
const MAX_ROWS = 10_000;

export async function GET(req: NextRequest, ctx: RouteContext<"/api/admin/export/[dataset]">) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  const { dataset: raw } = await ctx.params;
  // The link says ".csv" so the browser names the download sensibly; the route
  // key is the part before it.
  const dataset = raw.replace(/\.csv$/, "") as Dataset;
  if (!DATASETS.includes(dataset)) {
    return NextResponse.json({ error: `Unknown export. Try one of: ${DATASETS.join(", ")}.` }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const tournamentId = searchParams.get("tournamentId") ?? undefined;
  const settings = await getSettings();
  const tz = settings.timezone;
  const stamp = fileStamp();

  if (dataset === "bookings") {
    const range = dateRange(searchParams.get("from"), searchParams.get("to"), tz);
    if (range === "invalid") {
      return NextResponse.json({ error: "from/to must be YYYY-MM-DD dates." }, { status: 400 });
    }

    // `all`, or absent, means every status — same vocabulary as the status
    // chips on /admin/bookings.
    const status = searchParams.get("status");
    if (status && status !== "all" && !(status in BOOKING_STATUS_LABELS)) {
      return NextResponse.json({ error: `Unknown booking status: ${status}.` }, { status: 400 });
    }
    const statusFilter = status && status !== "all" ? { status: status as never } : {};

    const [bookings, tiers] = await Promise.all([
      prisma.booking.findMany({
        where: {
          ...statusFilter,
          ...(range ? { startUtc: { gte: range.start, lt: range.end } } : {}),
        },
        include: { court: true, customer: true, payment: true, tournament: { select: { name: true } } },
        orderBy: { startUtc: "desc" },
        take: MAX_ROWS,
      }),
      getPriceTiers(),
    ]);

    type Row = (typeof bookings)[number];
    const columns: CsvColumn<Row>[] = [
      { header: "Booking ID", value: (b) => b.id },
      { header: "Court", value: (b) => b.court.name },
      { header: "Start", value: (b) => csvDateTime(b.startUtc, tz) },
      { header: "End", value: (b) => csvDateTime(b.endUtc, tz) },
      { header: "Hours", value: (b) => b.hours },
      { header: "Status", value: (b) => bookingStatusLabel(b) },
      { header: "Customer", value: (b) => b.customer.name },
      { header: "Email", value: (b) => b.customer.email },
      { header: "Phone", value: (b) => b.customer.phone },
      {
        header: `Amount (${settings.currency})`,
        value: (b) =>
          csvMoney(
            computeBookingPriceCents({
              startMs: b.startUtc.getTime(),
              hours: b.hours,
              slotDurationMin: settings.slotDurationMin,
              tz,
              tiers,
              fallbackCentsPerHour: settings.priceCentsPerHour,
            }),
          ),
      },
      { header: "Pay method", value: (b) => (b.payMethod ? (PAY_METHOD_LABELS[b.payMethod] ?? b.payMethod) : "") },
      { header: "Reference no.", value: (b) => b.payment?.referenceNumber ?? "" },
      { header: "Payment status", value: (b) => b.payment?.status ?? "" },
      // Tournament court blocks are Bookings too — labelling them keeps a
      // revenue total from quietly counting a blocked court as a sale.
      { header: "Tournament block", value: (b) => b.tournament?.name ?? "" },
      { header: "Note", value: (b) => b.customerNote },
      { header: "Booked at", value: (b) => csvDateTime(b.createdAt, tz) },
    ];
    return csvResponse(toCsv(bookings, columns), `bookings-${stamp}.csv`);
  }

  if (dataset === "tournaments") {
    const tournaments = await prisma.tournament.findMany({
      where: tournamentId ? { id: tournamentId } : {},
      include: {
        courts: { include: { court: { select: { name: true } } } },
        registrations: { select: { status: true } },
        matches: { select: { status: true } },
        createdBy: { select: { name: true, email: true } },
      },
      orderBy: { startAt: "desc" },
      take: MAX_ROWS,
    });

    type Row = (typeof tournaments)[number];
    const count = (r: Row, status: string) => r.registrations.filter((x) => x.status === status).length;
    const columns: CsvColumn<Row>[] = [
      { header: "Tournament ID", value: (t) => t.id },
      { header: "Name", value: (t) => t.name },
      { header: "Format", value: (t) => FORMAT_LABELS[t.format] },
      { header: "Play type", value: (t) => PLAY_TYPE_LABELS[t.playType] },
      { header: "Skill level", value: (t) => t.skillLevel || "All levels" },
      { header: "Status", value: (t) => TOURNAMENT_STATUS_LABELS[t.status] },
      { header: "Registered", value: (t) => count(t, "registered") },
      { header: "Waitlisted", value: (t) => count(t, "waitlisted") },
      { header: "Withdrawn", value: (t) => count(t, "withdrawn") },
      { header: "Max entries", value: (t) => t.maxEntries },
      { header: "Min entries", value: (t) => t.minEntries },
      { header: `Entry fee (${settings.currency})`, value: (t) => csvMoney(t.entryFeeCents) },
      { header: "Matches", value: (t) => t.matches.length },
      {
        header: "Matches played",
        value: (t) => t.matches.filter((m) => m.status === "completed" || m.status === "walkover").length,
      },
      { header: "Courts", value: (t) => t.courts.map((c) => c.court.name).join(" / ") },
      { header: "Registration opens", value: (t) => csvDateTime(t.registrationOpensAt, tz) },
      { header: "Registration closes", value: (t) => csvDateTime(t.registrationClosesAt, tz) },
      { header: "Play starts", value: (t) => csvDateTime(t.startAt, tz) },
      { header: "Estimated end", value: (t) => csvDateTime(t.estimatedEndAt, tz) },
      { header: "Completed", value: (t) => csvDateTime(t.completedAt, tz) },
      { header: "Created by", value: (t) => t.createdBy.name || t.createdBy.email },
      { header: "Created at", value: (t) => csvDateTime(t.createdAt, tz) },
    ];
    return csvResponse(toCsv(tournaments, columns), `tournaments-${stamp}.csv`);
  }

  if (dataset === "entries") {
    const entries = await prisma.registration.findMany({
      where: tournamentId ? { tournamentId } : {},
      include: {
        tournament: { select: { name: true, entryFeeCents: true } },
        player1: { select: { name: true, email: true, phone: true } },
        player2: { select: { name: true, email: true, phone: true } },
      },
      orderBy: [{ tournamentId: "asc" }, { seed: "asc" }, { registeredAt: "asc" }],
      take: MAX_ROWS,
    });

    type Row = (typeof entries)[number];
    const columns: CsvColumn<Row>[] = [
      { header: "Tournament", value: (e) => e.tournament.name },
      { header: "Entry", value: (e) => entryName(e) },
      { header: "Seed", value: (e) => e.seed ?? "" },
      { header: "Status", value: (e) => e.status },
      { header: "Player 1", value: (e) => e.player1.name },
      { header: "Player 1 email", value: (e) => e.player1.email },
      { header: "Player 1 phone", value: (e) => e.player1.phone },
      { header: "Player 2", value: (e) => e.player2?.name ?? "" },
      { header: "Player 2 email", value: (e) => e.player2?.email ?? "" },
      { header: "Player 2 phone", value: (e) => e.player2?.phone ?? "" },
      { header: `Entry fee (${settings.currency})`, value: (e) => csvMoney(e.tournament.entryFeeCents) },
      { header: "Fee paid", value: (e) => (e.feePaid ? "yes" : "no") },
      { header: "Registered at", value: (e) => csvDateTime(e.registeredAt, tz) },
    ];
    return csvResponse(toCsv(entries, columns), `tournament-entries-${stamp}.csv`);
  }

  const matches = await prisma.match.findMany({
    where: tournamentId ? { tournamentId } : {},
    include: {
      tournament: { select: { name: true } },
      session: { select: { name: true, startAt: true } },
      court: { select: { name: true } },
      sideA: { include: { player1: { select: { name: true } }, player2: { select: { name: true } } } },
      sideB: { include: { player1: { select: { name: true } }, player2: { select: { name: true } } } },
    },
    orderBy: [{ tournamentId: "asc" }, { round: "asc" }, { matchNumber: "asc" }],
    take: MAX_ROWS,
  });

  type Row = (typeof matches)[number];
  const sideLabel = (side: Row["sideA"]) => (side ? entryName(side) : "");
  const columns: CsvColumn<Row>[] = [
    { header: "Tournament", value: (m) => m.tournament.name },
    { header: "Round", value: (m) => m.round },
    { header: "Match", value: (m) => m.matchNumber },
    { header: "Window", value: (m) => m.session?.name ?? "" },
    { header: "Window starts", value: (m) => csvDateTime(m.session?.startAt ?? null, tz) },
    { header: "Side A", value: (m) => sideLabel(m.sideA) },
    { header: "Side B", value: (m) => sideLabel(m.sideB) },
    { header: "Status", value: (m) => m.status },
    { header: "Court", value: (m) => m.court?.name ?? "" },
    { header: "Started", value: (m) => csvDateTime(m.scheduledAt, tz) },
    { header: "Finished", value: (m) => csvDateTime(m.completedAt, tz) },
    { header: "Score", value: (m) => m.score },
    {
      header: "Winner",
      value: (m) =>
        m.winnerRegistrationId === m.sideARegistrationId
          ? sideLabel(m.sideA)
          : m.winnerRegistrationId === m.sideBRegistrationId
            ? sideLabel(m.sideB)
            : "",
    },
  ];
  return csvResponse(toCsv(matches, columns), `tournament-matches-${stamp}.csv`);
}

/** Inclusive business-local date range as UTC instants, or null for "no filter".
 *  Returns "invalid" rather than silently exporting everything on a typo. */
function dateRange(
  from: string | null,
  to: string | null,
  tz: string,
): { start: Date; end: Date } | null | "invalid" {
  if (!from && !to) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if ((from && !iso.test(from)) || (to && !iso.test(to))) return "invalid";

  // Reuse the same local-day boundary logic the booking side uses, so an export
  // for "the 15th" covers exactly the day the admin sees in the app.
  const startISO = from ?? "1970-01-01";
  const endISO = to ?? "2999-12-31";
  return rangeUtcBounds(tz, startISO, endISO);
}
