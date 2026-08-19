import Link from "next/link";
import Image from "next/image";
import { getSessionUser } from "@/lib/auth-helpers";
import { getSettings } from "@/lib/booking-data";
import { SignInButton, SignOutButton } from "@/components/auth-buttons";
import { BottomNav } from "@/components/bottom-nav";
import { DesktopNav, type NavLink } from "@/components/site-nav";

export async function SiteHeader() {
  const [user, settings] = await Promise.all([getSessionUser(), getSettings()]);

  /* The desktop list. A phone gets the same destinations from the tab bar, in
     the order a thumb wants them rather than the order a menu wants them. */
  const links: NavLink[] = [
    { href: "/", label: "Home" },
    { href: "/book", label: "Book a court" },
    { href: "/tournaments", label: "Tournaments" },
    { href: "/my-bookings", label: "My bookings" },
    ...(user ? [{ href: "/profile", label: "Profile" }] : []),
    ...(user?.role === "admin" ? [{ href: "/admin", label: "Admin" }] : []),
  ];

  return (
    <>
      {/* Slim and frosted, so the hero's dusk scrolls under it rather than
          butting against a flat bar. */}
      <header className="glass-panel sticky top-0 z-50 border-b">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:h-16">
          <Link
            href="/"
            className="flex min-w-0 items-center gap-2.5 rounded-full font-display text-[0.95rem] font-semibold tracking-tight sm:text-base"
          >
            <Image
              src="/logo.png"
              alt=""
              width={36}
              height={36}
              className="size-9 shrink-0 rounded-full object-cover ring-1 ring-border"
            />
            <span className="truncate">{settings.businessName}</span>
          </Link>

          <div className="ml-auto hidden items-center gap-2 md:flex">
            <DesktopNav links={links} />
            <span className="mx-1 h-5 w-px bg-border" aria-hidden />
            {user ? <SignOutButton /> : <SignInButton className="btn btn-sm btn-primary" />}
          </div>

          {/* Admin is the one destination the tab bar has no room for, and the
              one an admin on a phone needs most. */}
          {user?.role === "admin" && (
            <Link href="/admin" className="btn btn-sm btn-outline ml-auto md:hidden">
              Admin
            </Link>
          )}
        </div>
      </header>

      <BottomNav signedIn={!!user} />
    </>
  );
}
