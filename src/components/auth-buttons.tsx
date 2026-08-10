import { signInWithGoogle, signOutAction } from "@/lib/actions/auth-actions";

export function SignInButton({ callbackUrl }: { callbackUrl?: string }) {
  return (
    <form action={signInWithGoogle.bind(null, callbackUrl ?? "/book")}>
      <button
        type="submit"
        className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90"
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
        className="rounded-full border border-destructive/40 px-4 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
      >
        Sign out
      </button>
    </form>
  );
}
