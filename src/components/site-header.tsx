import Link from "next/link";
import { getSessionUser } from "@/lib/auth-helpers";
import { getSettings } from "@/lib/booking-data";
import { SignInButton, SignOutButton } from "@/components/auth-buttons";

export async function SiteHeader() {
  const [user, settings] = await Promise.all([getSessionUser(), getSettings()]);

  return (
    <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="text-lg font-bold text-emerald-700 dark:text-emerald-400">
          {settings.businessName}
        </Link>
        <nav className="flex items-center gap-4 text-sm font-medium text-zinc-600 dark:text-zinc-300">
          <Link href="/book" className="hover:text-emerald-700 dark:hover:text-emerald-400">
            Book a court
          </Link>
          {user && (
            <Link href="/my-bookings" className="hover:text-emerald-700 dark:hover:text-emerald-400">
              My bookings
            </Link>
          )}
          {user?.role === "admin" && (
            <Link href="/admin" className="hover:text-emerald-700 dark:hover:text-emerald-400">
              Admin
            </Link>
          )}
          {user ? <SignOutButton /> : <SignInButton />}
        </nav>
      </div>
    </header>
  );
}
