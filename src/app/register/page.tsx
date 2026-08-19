import { redirect } from "next/navigation";
import { getSessionUser, getProfileCompletion } from "@/lib/auth-helpers";
import { getSettings } from "@/lib/booking-data";
import { RegisterForm } from "@/components/register-form";

export default async function RegisterPage(props: PageProps<"/register">) {
  const searchParams = await props.searchParams;
  const callbackUrl = typeof searchParams.callbackUrl === "string" ? searchParams.callbackUrl : "/book";

  const user = await getSessionUser();
  if (!user) {
    redirect(`/signin?callbackUrl=${encodeURIComponent(`/register?callbackUrl=${callbackUrl}`)}`);
  }

  const [{ name, phone, skillRating, complete }, settings] = await Promise.all([
    getProfileCompletion(user.id),
    getSettings(),
  ]);
  /* One job: get a member past the gate and back to what they were doing. Once
     they are past it there is nothing here for them — changing any of these
     later is /profile, which is reachable on purpose from the header. */
  if (complete) redirect(callbackUrl);

  return (
    <div className="dusk-panel grid flex-1 place-items-center px-4 py-12">
      <div className="surface-raised rise w-full max-w-md p-6 sm:p-8">
        <p className="eyebrow">One last thing</p>
        <h1 className="mt-4 text-2xl">Complete your profile</h1>
        <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
          {settings.businessName} needs your full name and mobile number before your first booking — that is how
          the staff know whose court it is.
        </p>
        <RegisterForm
          defaultName={name}
          defaultPhone={phone}
          defaultSkillRating={skillRating}
          email={user.email ?? ""}
          callbackUrl={callbackUrl}
        />
      </div>
    </div>
  );
}
