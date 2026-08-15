import Link from "next/link";
import Image from "next/image";
import { getSessionUser } from "@/lib/auth-helpers";
import { getSettings } from "@/lib/booking-data";
import { SignInButton, SignOutButton } from "@/components/auth-buttons";
import { MobileNav, type NavLink } from "@/components/mobile-nav";

export async function SiteHeader() {
  const [user, settings] = await Promise.all([getSessionUser(), getSettings()]);

  /* One list, rendered twice — inline on a desktop, inside the sheet on a
     phone — so the two can't drift apart as destinations are added. */
  const links: NavLink[] = [
    { href: "/", label: "Home" },
    { href: "/book", label: "Book a court" },
    { href: "/tournaments", label: "Tournaments" },
    { href: "/my-bookings", label: "My bookings" },
    /* Signed-in only: there is nothing to show a stranger, and the page would
       only bounce them to sign in. It earns a top-level link because the skill
       level lives there, and a member who can't find it can't enter a
       tournament with a level band. */
    ...(user ? [{ href: "/profile", label: "Profile" }] : []),
    ...(user?.role === "admin" ? [{ href: "/admin", label: "Admin" }] : []),
  ];

  const authButton = user ? <SignOutButton /> : <SignInButton />;

  return (
    /* Sticky keeps the nav reachable on a phone without scrolling back up a
       long booking grid, and doubles as the positioned ancestor the mobile
       sheet hangs off. */
    <header className="sticky top-0 z-50 border-b border-border bg-background">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-3 py-3 sm:px-4">
        <Link
          href="/"
          className="flex min-w-0 items-center gap-2 font-display text-base font-bold text-primary sm:text-lg"
        >
          <Image
            src="/logo.png"
            alt={settings.businessName}
            width={28}
            height={28}
            className="size-7 shrink-0 rounded-lg object-cover"
          />
          <span className="truncate">{settings.businessName}</span>
        </Link>

        {/* Everything inline once there is room for it — roughly a tablet up. */}
        <nav className="hidden items-center gap-5 text-sm font-medium text-muted-foreground md:flex">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="transition-colors hover:text-foreground">
              {link.label}
            </Link>
          ))}
          {authButton}
        </nav>

        <MobileNav links={links}>{authButton}</MobileNav>
      </div>
    </header>
  );
}
