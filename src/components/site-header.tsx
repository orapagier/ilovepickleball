import Link from "next/link";
import Image from "next/image";
import { getSessionUser } from "@/lib/auth-helpers";
import { getSettings } from "@/lib/booking-data";
import { SignInButton, SignOutButton } from "@/components/auth-buttons";

export async function SiteHeader() {
  const [user, settings] = await Promise.all([getSessionUser(), getSettings()]);

  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-3 sm:px-4">
        <Link href="/" className="flex min-w-0 items-center gap-2 font-display text-base font-bold text-primary sm:text-lg">
          <Image
            src="/logo.png"
            alt={settings.businessName}
            width={28}
            height={28}
            className="size-7 shrink-0 rounded-lg object-cover"
          />
          <span className="truncate">{settings.businessName}</span>
        </Link>
        {/* `ml-auto` keeps the links flush right even when the header wraps and
            the nav gets a line of its own. */}
        <nav className="ml-auto flex items-center justify-end gap-3 text-sm font-medium text-muted-foreground sm:gap-5">
          <Link href="/" className="transition-colors hover:text-foreground">
            Home
          </Link>
          <Link href="/book" className="transition-colors hover:text-foreground">
            Book<span className="hidden sm:inline"> a court</span>
          </Link>
          <Link href="/my-bookings" className="transition-colors hover:text-foreground">
            <span className="hidden sm:inline">My b</span>
            <span className="sm:hidden">B</span>ookings
          </Link>
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
