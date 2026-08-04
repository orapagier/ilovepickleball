import { signInWithGoogle, signOutAction } from "@/lib/actions/auth-actions";

export function SignInButton({ callbackUrl }: { callbackUrl?: string }) {
  return (
    <form action={signInWithGoogle.bind(null, callbackUrl ?? "/book")}>
      <button
        type="submit"
        className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
      >
        Sign in with Google
      </button>
    </form>
  );
}

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        Sign out
      </button>
    </form>
  );
}
