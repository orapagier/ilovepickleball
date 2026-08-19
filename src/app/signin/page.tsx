import Link from "next/link";
import Image from "next/image";
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
    <div className="dusk-panel grid flex-1 place-items-center px-4 py-14">
      <div className="surface-raised rise w-full max-w-sm p-7 text-center sm:p-8">
        <Image
          src="/logo.png"
          alt=""
          width={64}
          height={64}
          className="mx-auto size-16 rounded-full object-cover ring-1 ring-border"
        />
        <h1 className="mt-5 text-2xl">{settings.businessName}</h1>
        <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
          Sign in to reserve a court, pay from your phone and follow the tournaments you&rsquo;ve entered.
        </p>

        <form action={signInWithGoogle.bind(null, callbackUrl)}>
          <button type="submit" className="btn btn-primary mt-7 w-full py-3.5">
            Continue with Google
          </button>
        </form>

        <p className="mt-4 text-xs text-muted-foreground">
          We only ever use your Google account to know who holds the booking.
        </p>

        <Link
          href="/"
          className="mt-6 inline-block text-sm font-bold text-primary underline-offset-4 hover:underline"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}
