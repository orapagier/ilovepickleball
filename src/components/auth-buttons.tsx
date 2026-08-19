import { signInWithGoogle, signOutAction } from "@/lib/actions/auth-actions";

/** `className` is a slot rather than a size prop: the header wants a compact
 *  pill and a page panel wants a full-width one, and there is no third case
 *  worth naming. */
export function SignInButton({
  callbackUrl,
  className = "btn btn-primary",
}: {
  callbackUrl?: string;
  className?: string;
}) {
  return (
    <form action={signInWithGoogle.bind(null, callbackUrl ?? "/book")}>
      <button type="submit" className={className}>
        Sign in with Google
      </button>
    </form>
  );
}

export function SignOutButton({ className = "btn btn-sm btn-outline" }: { className?: string }) {
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        className={`${className} hover:border-destructive/40 hover:text-destructive`}
      >
        Sign out
      </button>
    </form>
  );
}
