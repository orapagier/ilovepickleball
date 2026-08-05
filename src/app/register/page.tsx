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

  const [{ name, phone, complete }, settings] = await Promise.all([
    getProfileCompletion(user.id),
    getSettings(),
  ]);
  if (complete) redirect(callbackUrl);

  return (
    <div className="grid flex-1 place-items-center court-panel px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-navy-foreground/15 bg-background p-8 text-foreground shadow-lift">
        <h1 className="text-2xl font-bold">Complete your profile</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {settings.businessName} requires your complete name and mobile number before you can book a court.
        </p>
        <RegisterForm defaultName={name} defaultPhone={phone} email={user.email ?? ""} callbackUrl={callbackUrl} />
      </div>
    </div>
  );
}
