import Link from "next/link";
import { ArrowRight, Trophy } from "lucide-react";
import { formatDateTimeShort } from "@/lib/format";
import { formatSkillBand } from "@/lib/skill";
import { FORMAT_LABELS, PLAY_TYPE_LABELS } from "@/lib/tournament";
import type { LatestChampion } from "@/lib/tournament-data";

/**
 * Who won the last tournament, on the homepage.
 *
 * It sits under "Host an event" because that column was asking a club to come
 * and play here and then stopping halfway — the answer to "is anything actually
 * won here" was nowhere on the page. A face and a name is the whole point of
 * it: the draw, the standings and the prize list all live on the tournament's
 * own page, one tap away.
 *
 * Dusk rather than vellum. The white cards in this section are reference — the
 * hours, the rates, the phone number — and this is the one tile on the page
 * that is about a person.
 */
export function ChampionCard({ champion, tz }: { champion: LatestChampion; tz: string }) {
  const names = champion.players.map((p) => p.name.trim() || "Unnamed member");

  return (
    <section className="dusk-panel mt-4 overflow-hidden rounded-2xl border border-border shadow-raised">
      <div className="flex flex-col gap-5 p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <p className="eyebrow eyebrow-on-dusk">Reigning champion</p>
          {champion.completedAt && (
            <p className="text-xs text-dusk-foreground/55">
              Won {formatDateTimeShort(champion.completedAt, tz)}
            </p>
          )}
        </div>

        <div className="flex items-center gap-4">
          {/* Doubles is two winners, so it is two faces — the second tucked
              behind the first rather than a second row, because they won one
              thing between them. */}
          <div className="flex shrink-0 -space-x-4">
            {champion.players.map((p, i) => (
              <Face key={i} src={p.image} name={p.name} />
            ))}
          </div>
          <div className="min-w-0">
            <h3 className="font-display text-2xl leading-tight text-dusk-foreground sm:text-[1.75rem]">
              {names.join(" & ")}
            </h3>
            <p className="mt-1 truncate text-sm text-dusk-foreground/70">{champion.name}</p>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-white/12 pt-4 text-sm">
          <div className="min-w-0">
            <dt className="text-[0.65rem] font-bold uppercase tracking-[0.14em] text-dusk-foreground/55">
              Category
            </dt>
            <dd className="mt-1 font-bold text-dusk-foreground">
              {PLAY_TYPE_LABELS[champion.playType]} ·{" "}
              {formatSkillBand(champion.minSkillRating, champion.maxSkillRating)}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[0.65rem] font-bold uppercase tracking-[0.14em] text-dusk-foreground/55">
              Format
            </dt>
            <dd className="mt-1 font-bold text-dusk-foreground">{FORMAT_LABELS[champion.format]}</dd>
          </div>
        </dl>

        <Link href={`/tournaments/${champion.id}`} className="btn btn-sm btn-on-dusk self-start">
          See the draw
          <ArrowRight className="size-3.5" />
        </Link>
      </div>
    </section>
  );
}

/** A winner's own picture when they have set one, and the trophy when they
 *  haven't. A silhouette would be a missing photo; a trophy is the thing they
 *  actually won, and every champion has one. */
function Face({ src, name }: { src: string; name: string }) {
  const ring = "size-16 shrink-0 rounded-full ring-2 ring-dusk object-cover sm:size-18";
  if (src) {
    /* eslint-disable-next-line @next/next/no-img-element -- a member's own
       upload is a data URL and a Google avatar is a remote host; neither is
       worth a loader config for a 72px circle. */
    return <img src={src} alt={name} className={`${ring} bg-white/10`} />;
  }
  return (
    <span className={`${ring} flex items-center justify-center bg-white/12`}>
      <Trophy className="size-7 text-dusk-foreground/85" />
    </span>
  );
}
