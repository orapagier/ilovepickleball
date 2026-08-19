"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export type NavLink = { href: string; label: string };

/** Whether a nav link is the page being looked at. "/" has to match exactly or
 *  it would light up on every route. */
export function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/**
 * The header's links on a tablet and up.
 *
 * A phone never sees this — down there the destinations live in the bottom tab
 * bar, where a thumb can reach them. The active link is a filled rose pill
 * rather than a colour change alone, so it survives being looked at by somebody
 * who can't separate the two colours.
 */
export function DesktopNav({ links }: { links: NavLink[] }) {
  const pathname = usePathname();

  return (
    <nav className="hidden items-center gap-0.5 md:flex">
      {links.map((link) => {
        const active = isActive(pathname, link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-full px-3.5 py-2 text-sm font-semibold transition-colors",
              active
                ? "bg-primary/12 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
