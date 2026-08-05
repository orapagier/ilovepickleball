import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth-helpers";
import { getSettings } from "@/lib/booking-data";
import { signInWithGoogle } from "@/lib/actions/auth-actions";

export default async function SignInPage(props: PageProps<"/signin">) {
  const searchParams = await props.searchParams;
  const callbackUrl = typeof searchParams.callbackUrl === "string" ? searchParams.callbackUrl : "/book";

  const [user, settings] = await Promise.all([getSessionUser(), getSettings()]);
  if (user) redirect(callbackUrl);

  return (
    <div className="grid flex-1 place-items-center court-panel px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-navy-foreground/15 bg-background p-8 text-foreground shadow-lift">
        <h1 className="text-2xl font-bold">{settings.businessName}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in with your Google account to reserve a court and manage your bookings.
        </p>

        <form action={signInWithGoogle.bind(null, callbackUrl)}>
          <button
            type="submit"
            className="mt-8 flex w-full items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90"
          >
            Continue with Google
          </button>
        </form>

        <Link
          href="/"
          className="mt-6 block text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}
