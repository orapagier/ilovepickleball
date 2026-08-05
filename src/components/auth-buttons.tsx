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
        className="rounded-full border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        Sign out
      </button>
    </form>
  );
}
