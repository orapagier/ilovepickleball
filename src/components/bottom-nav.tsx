"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarPlus, Home, Ticket, Trophy, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { isActive } from "@/components/site-nav";

/**
 * The phone's navigation: a fixed tab bar under the thumb.
 *
 * It replaces a hamburger sheet, which put every destination two taps away and
 * hid which one you were on. Five destinations is the ceiling for a bar this
 * width, so the two that don't fit — admin, sign out — live on the You tab,
 * which is where somebody would look for them anyway.
 *
 * Frosted rather than solid: the page scrolls under it, and on the homepage the
 * dusk footer runs beneath it (see `under-tabbar`), so the bar reads as a layer
 * of the app rather than a strip cut out of the bottom of the page.
 */
type Tab = { href: string; label: string; icon: LucideIcon };

const TABS: Tab[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/book", label: "Book", icon: CalendarPlus },
  { href: "/tournaments", label: "Play", icon: Trophy },
  { href: "/my-bookings", label: "Bookings", icon: Ticket },
];

export function BottomNav({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname();
  /* Signed out, the last tab is the way in rather than a profile that would
     only bounce them to sign in. */
  const tabs: Tab[] = [
    ...TABS,
    signedIn
      ? { href: "/profile", label: "You", icon: UserRound }
      : { href: "/signin", label: "Sign in", icon: UserRound },
  ];

  return (
    <nav
      aria-label="Main"
      className="glass-panel fixed inset-x-0 bottom-0 z-50 border-t pb-safe pt-1.5 md:hidden"
    >
      <ul className="mx-auto flex max-w-lg items-stretch">
        {tabs.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className="flex flex-col items-center gap-1 rounded-2xl px-1 py-1 transition-transform active:scale-95"
              >
                <span
                  className={cn(
                    "flex h-8 w-14 items-center justify-center rounded-full transition-colors",
                    active ? "bg-primary/14 text-primary" : "text-muted-foreground",
                  )}
                >
                  <Icon className="size-[1.15rem]" strokeWidth={active ? 2.4 : 1.9} />
                </span>
                <span
                  className={cn(
                    "text-[0.625rem] font-bold tracking-wide transition-colors",
                    active ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  {label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
