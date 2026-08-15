import Link from "next/link";
import { DateTime } from "luxon";
import { getActiveCourts, getSettings } from "@/lib/booking-data";
import { TournamentForm } from "@/components/tournament/tournament-form";

export default async function NewTournamentPage() {
  const [courts, settings] = await Promise.all([getActiveCourts(), getSettings()]);
  const now = DateTime.now().setZone(settings.timezone);

  /* Sensible starting dates rather than empty fields: entries close a week out
     in the evening, play starts the next morning. Both are business-local, the
     zone `saveTournament` reads them back in. */
  const closes = now.plus({ days: 7 }).set({ hour: 18, minute: 0, second: 0, millisecond: 0 });
  const starts = closes.plus({ days: 1 }).set({ hour: 8, minute: 0 });
  const asInput = (dt: DateTime) => dt.toFormat("yyyy-LL-dd'T'HH:mm");

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Link href="/admin/tournaments" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
        ← Tournaments
      </Link>
      <div>
        <h1 className="text-3xl font-bold">New tournament</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Saving creates it as a draft — nothing is visible to members until you publish it.
        </p>
      </div>

      <TournamentForm
        status="draft"
        currency={settings.currency}
        courts={courts}
        defaultPacing={{
          matchMinutes: settings.averageMatchMinutes,
          changeoverMinutes: settings.courtChangeoverMinutes,
        }}
        initial={{
          name: "",
          description: "",
          format: "single_elimination",
          playType: "doubles",
          minSkillRating: "",
          maxSkillRating: "",
          maxEntries: 8,
          minEntries: 4,
          entryFee: "0",
          registrationOpensAt: "",
          registrationClosesAt: asInput(closes),
          startAt: asInput(starts),
          courtIds: courts.map((c) => c.id),
          prizeDescription: "",
          poolCount: "",
          advancePerPool: "",
          swissRounds: "",
          averageMatchMinutes: "",
          courtChangeoverMinutes: "",
        }}
      />
    </div>
  );
}
