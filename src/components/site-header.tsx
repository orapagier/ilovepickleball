import Link from "next/link";
import { getSessionUser } from "@/lib/auth-helpers";
import { getSettings } from "@/lib/booking-data";
import { SignInButton, SignOutButton } from "@/components/auth-buttons";

export async function SiteHeader() {
  const [user, settings] = await Promise.all([getSessionUser(), getSettings()]);

  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="font-display text-lg font-bold text-primary">
          {settings.businessName}
        </Link>
        <nav className="flex items-center gap-5 text-sm font-medium text-muted-foreground">
          <Link href="/book" className="transition-colors hover:text-foreground">
            Book a court
          </Link>
          {user && (
            <Link href="/my-bookings" className="transition-colors hover:text-foreground">
              My bookings
            </Link>
          )}
          {user?.role === "admin" && (
            <Link href="/admin" className="transition-colors hover:text-foreground">
              Admin
            </Link>
          )}
          {user ? <SignOutButton /> : <SignInButton />}
        </nav>
      </div>
    </header>
  );
}
