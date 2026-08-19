import Link from "next/link";
import { Plus } from "lucide-react";
import type { TournamentStatus } from "@/generated/prisma/enums";
import { getSettings } from "@/lib/booking-data";
import { formatDateTimeShort } from "@/lib/format";
import { listAdminTournaments } from "@/lib/tournament-data";
import { FORMAT_LABELS, PLAY_TYPE_LABELS } from "@/lib/tournament";
import { TournamentStatusBadge } from "@/components/tournament/status-badge";
import { ExportLink } from "@/components/admin/export-link";

/** Three buckets, in the order an admin cares about them on the day: what's
 *  being set up, what's live, and what's over. */
const GROUPS: { title: string; statuses: TournamentStatus[] }[] = [
  { title: "Live", statuses: ["registration_open", "registration_closed", "in_progress"] },
  { title: "Drafts", statuses: ["draft"] },
  { title: "Past", statuses: ["completed", "cancelled"] },
];

export default async function AdminTournamentsPage() {
  const [tournaments, settings] = await Promise.all([listAdminTournaments(), getSettings()]);
  const tz = settings.timezone;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {tournaments.length > 0 && (
            <ExportLink href="/api/admin/export/tournaments.csv">Export CSV</ExportLink>
          )}
          <Link
            href="/admin/tournaments/new"
            className="btn btn-primary"
          >
            <Plus className="size-4" />
            New tournament
          </Link>
        </div>
      </div>

      {tournaments.length === 0 && (
        <p className="surface-card p-6 text-center text-sm text-muted-foreground">
          No tournaments yet. Create one as a draft, then publish it when you&rsquo;re ready to take entries.
        </p>
      )}

      {GROUPS.map((group) => {
        const rows = tournaments.filter((t) => group.statuses.includes(t.status));
        if (rows.length === 0) return null;

        return (
          <section key={group.title} className="flex flex-col gap-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {group.title}
            </h2>
            <ul className="flex flex-col gap-2">
              {rows.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/admin/tournaments/${t.id}`}
                    className="surface-card flex flex-wrap items-center justify-between gap-3 p-4 transition-colors hover:border-primary"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{t.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTimeShort(t.startAt, tz)} · {FORMAT_LABELS[t.format]} ·{" "}
                        {PLAY_TYPE_LABELS[t.playType]} · {t._count.registrations}/{t.maxEntries} entries
                        {t._count.matches > 0 && ` · ${t._count.matches} matches`}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {t.status === "in_progress" && (
                        <span className="text-xs font-semibold text-primary">Run day →</span>
                      )}
                      <TournamentStatusBadge status={t.status} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
