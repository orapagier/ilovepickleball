import Link from "next/link";
import { redirect } from "next/navigation";
import { getProfileCompletion, getSessionUser } from "@/lib/auth-helpers";
import { getSettings } from "@/lib/booking-data";
import { listPublicTournaments } from "@/lib/tournament-data";
import { describeSkillRating, findSkillOption } from "@/lib/skill";
import { ProfileForm } from "@/components/profile-form";

/**
 * A member's own details, and the one place they set the skill level that
 * decides which tournaments they can enter.
 *
 * Separate from /register, which is the gate that collects a name and mobile
 * number before a first booking and then gets out of the way. A rating is not
 * part of that gate — it has nothing to do with booking a court — so it needs
 * somewhere that is reachable on purpose rather than only when being stopped.
 */
export default async function ProfilePage() {
  const user = await getSessionUser();
  if (!user) redirect("/signin?callbackUrl=/profile");

  const [{ name, phone, skillRating }, settings] = await Promise.all([
    getProfileCompletion(user.id),
    getSettings(),
  ]);

  const option = findSkillOption(skillRating);
  /* What the rating is actually worth to them, counted rather than described:
     the tournaments open to entry that would take them at this level. Only
     meaningful once rated — unrated, the honest answer is "the ones that take
     all levels", which is the prompt below instead of a number. */
  const openToMe =
    skillRating === null
      ? []
      : await listPublicTournaments({ status: "registration_open", openToRating: skillRating });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-3xl font-bold">My profile</h1>
        <Link href="/my-bookings" className="text-sm font-medium text-primary hover:underline">
          My bookings
        </Link>
      </div>

      <section className="surface-card flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="font-semibold">Skill level</h2>
          <p className="text-sm font-medium">{describeSkillRating(skillRating)}</p>
        </div>

        {option ? (
          <>
            <p className="text-sm text-muted-foreground">{option.readiness}</p>
            <p className="text-sm text-muted-foreground">
              {openToMe.length === 0 ? (
                <>No tournaments are taking entries at your level right now.</>
              ) : (
                <>
                  {openToMe.length === 1
                    ? "1 tournament is taking entries"
                    : `${openToMe.length} tournaments are taking entries`}{" "}
                  at your level.{" "}
                  <Link
                    href={`/tournaments?skill=${skillRating}`}
                    className="font-medium text-primary hover:underline"
                  >
                    Browse them
                  </Link>
                  .
                </>
              )}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            You haven&rsquo;t set a level yet. That&rsquo;s fine for booking courts and for tournaments open to all
            levels, but a tournament limited to a range of levels can&rsquo;t take an entry it can&rsquo;t place —
            set one below and you can enter straight away.
          </p>
        )}

        {/* Self-declared, and said so plainly: a member who thinks the number is
            verified will read a band as an insult rather than a category. */}
        <p className="text-xs text-muted-foreground">
          You set this yourself, and {settings.businessName} staff can correct it. Changing it never affects an
          entry already accepted into a draw.
        </p>
      </section>

      <section className="surface-card flex flex-col gap-4 p-5">
        <h2 className="font-semibold">Your details</h2>
        <ProfileForm
          defaultName={name}
          defaultPhone={phone}
          defaultSkillRating={skillRating}
          email={user.email ?? ""}
        />
      </section>
    </div>
  );
}
