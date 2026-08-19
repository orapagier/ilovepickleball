/**
 * Remove everything `scripts/simulate-tournaments.ts` created, and nothing else.
 *
 *   npx tsx --env-file=.env.local scripts/cleanup-simulated-tournaments.ts
 *   npx tsx --env-file=.env.local scripts/cleanup-simulated-tournaments.ts --dry-run
 *
 * DATABASE_URL points at a shared development database with real bookings and
 * real members in it, so this is deliberately narrow: it matches tournaments by
 * the `[SIM]` name tag and members by the `sim-` googleSub prefix, and it never
 * truncates anything. A real tournament called anything else, and a real member
 * signed in with a real Google account, cannot be selected by either filter.
 *
 * Order matters, because the schema does not cascade all of it:
 *
 *  1. **Court blocks first.** `Booking.tournamentId` is `ON DELETE SET NULL`, so
 *     deleting the tournament would leave the blocks behind as orphaned
 *     bookings owned by whichever admin published — the same trap
 *     `deleteTournament` steps around in `tournament-actions.ts`.
 *  2. **Then the tournaments**, which cascade to their entries, matches, windows,
 *     court joins and prizes.
 *  3. **Then the members**, last, because until their entries are gone the
 *     foreign keys from `Registration` still hold them.
 *
 * Run it with `--dry-run` first if you want to see the counts before anything
 * goes; there is no undo.
 */

import { prisma } from "@/lib/prisma";

const SIM_TAG = "[SIM]";
const SIM_SUB_PREFIX = "sim-";
const SIM_EMAIL_DOMAIN = "@simulated.test";

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const tournaments = await prisma.tournament.findMany({
    where: { name: { startsWith: SIM_TAG } },
    select: {
      id: true,
      name: true,
      _count: { select: { registrations: true, matches: true, sessions: true, prizes: true, courtBlocks: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  /* Both markers have to agree before a member is deleted. The sub is what the
     script sets and the address is what it sets it to; requiring the pair means
     a real account that somehow started with "sim-" is still safe. */
  const users = await prisma.user.findMany({
    where: { googleSub: { startsWith: SIM_SUB_PREFIX }, email: { endsWith: SIM_EMAIL_DOMAIN } },
    select: { id: true, email: true },
  });

  const ids = tournaments.map((t) => t.id);
  const blocks = ids.length > 0 ? await prisma.booking.count({ where: { tournamentId: { in: ids } } }) : 0;

  console.log(`${tournaments.length} simulated tournaments:`);
  for (const t of tournaments) {
    const c = t._count;
    console.log(
      `  ${t.name} — ${c.registrations} entries, ${c.matches} matches, ${c.prizes} prizes, ${c.courtBlocks} court blocks`,
    );
  }
  console.log(`${blocks} court blocks, ${users.length} simulated members.`);

  if (dryRun) {
    console.log("\n--dry-run: nothing deleted.");
    await prisma.$disconnect();
    return;
  }

  if (ids.length > 0) {
    // Deleted outright rather than cancelled: these blocks were never on
    // anybody's calendar but the sim's, so there is no mirror to tell.
    const removedBlocks = await prisma.booking.deleteMany({ where: { tournamentId: { in: ids } } });
    const removedTournaments = await prisma.tournament.deleteMany({ where: { id: { in: ids } } });
    console.log(`\nDeleted ${removedBlocks.count} court blocks and ${removedTournaments.count} tournaments.`);
  }

  if (users.length > 0) {
    /* A sim member with anything left pointing at them is a member this script
       cannot safely delete — a real booking made under a sim account, say. Say
       so rather than failing on the foreign key. */
    const userIds = users.map((u) => u.id);
    const [stillEntered, stillBooked] = await Promise.all([
      prisma.registration.findMany({
        where: { OR: [{ player1Id: { in: userIds } }, { player2Id: { in: userIds } }] },
        select: { player1Id: true, player2Id: true },
      }),
      prisma.booking.findMany({ where: { customerId: { in: userIds } }, select: { customerId: true } }),
    ]);
    const held = new Set([
      ...stillEntered.flatMap((r) => [r.player1Id, r.player2Id]).filter((id): id is string => id != null),
      ...stillBooked.map((b) => b.customerId),
    ]);

    const removable = userIds.filter((id) => !held.has(id));
    const removed = await prisma.user.deleteMany({ where: { id: { in: removable } } });
    console.log(`Deleted ${removed.count} simulated members.`);
    if (held.size > 0) {
      console.log(
        `Kept ${held.size} simulated members that are still referenced by a registration or a booking — ` +
          `delete whatever is holding them and re-run.`,
      );
    }
  }

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error("CLEANUP FAILED\n", error);
  await prisma.$disconnect();
  process.exit(1);
});
