"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BellRing,
  CalendarDays,
  CalendarOff,
  Clock,
  Coins,
  LayoutDashboard,
  LayoutGrid,
  Settings2,
  Trophy,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";

/**
 * The admin sidebar.
 *
 * Ten destinations is too many for one list to be read as a list, so they are
 * grouped by how often a day touches them: what is happening today, what is
 * being run, and what is configured once and left alone. The groups are the
 * navigation — an admin looking for Blackout dates is looking in Setup, and
 * never has to scan past Pricing to find it.
 *
 * A scrolling row of pills on a phone and a labelled column on a laptop, where
 * it sticks under the header while a long bookings table scrolls past it.
 *
 * `/admin` is matched exactly; every other row matches its prefix, so the two
 * tournament detail routes still light up their parent.
 */
type Item = { href: string; label: string; icon: LucideIcon };
type Group = { heading: string; items: Item[] };

const GROUPS: Group[] = [
  {
    heading: "Today",
    items: [
      { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
      { href: "/admin/queue", label: "Pending actions", icon: BellRing },
      { href: "/admin/bookings", label: "All bookings", icon: CalendarDays },
    ],
  },
  {
    heading: "Club",
    items: [
      { href: "/admin/tournaments", label: "Tournaments", icon: Trophy },
      { href: "/admin/users", label: "Registered users", icon: Users },
    ],
  },
  {
    heading: "Setup",
    items: [
      { href: "/admin/settings", label: "Settings", icon: Settings2 },
      { href: "/admin/pricing", label: "Pricing", icon: Coins },
      { href: "/admin/courts", label: "Courts", icon: LayoutGrid },
      { href: "/admin/hours", label: "Hours", icon: Clock },
      { href: "/admin/blackouts", label: "Blackout dates", icon: CalendarOff },
    ],
  },
];

/** Where the nav's short label isn't what the page calls itself. */
const TITLES: Record<string, string> = {
  "/admin/hours": "Weekly hours",
  "/admin/pricing": "Court rates",
};

/**
 * The same dusk band Book and Tournaments open with, titled from the nav entry
 * the route sits under — so the admin area reads as part of one product rather
 * than a bare heading on the page background. A detail page (a tournament, a
 * user) keeps its own name in an h1 under the band.
 */
export function AdminHeader() {
  const pathname = usePathname();
  // Longest match wins, so /admin/tournaments/new lands under Tournaments.
  const current = GROUPS.flatMap((g) => g.items)
    .filter((i) => isCurrent(pathname, i.href))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return <PageHeader eyebrow="Admin" title={current ? (TITLES[current.href] ?? current.label) : "Admin"} />;
}

function isCurrent(pathname: string, href: string): boolean {
  return href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
}

export function AdminNav() {
  const pathname = usePathname();

  return (
    <>
      {/* Phone: one strip, no headings — a group label is a signpost for a
          column you can see all of, and this one is swiped. */}
      <nav
        aria-label="Admin"
        className="no-scrollbar -mx-4 flex shrink-0 gap-1.5 overflow-x-auto px-4 pb-1 lg:hidden"
      >
        {GROUPS.flatMap((g) => g.items).map(({ href, label, icon: Icon }) => {
          const active = isCurrent(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-3.5 py-2 text-sm font-bold transition-colors",
                active
                  ? "bg-primary text-primary-foreground shadow-glow"
                  : "bg-card text-muted-foreground shadow-card hover:text-foreground",
              )}
            >
              <Icon className="size-4" strokeWidth={active ? 2.4 : 1.9} />
              {label}
            </Link>
          );
        })}
      </nav>

      <nav
        aria-label="Admin"
        className="surface-card hidden shrink-0 flex-col gap-5 p-3 lg:sticky lg:top-20 lg:flex lg:w-60 lg:self-start"
      >
        {GROUPS.map((group) => (
          <div key={group.heading} className="flex flex-col gap-1">
            <p className="px-3 pb-1 text-[0.65rem] font-bold uppercase tracking-[0.16em] text-muted-foreground/70">
              {group.heading}
            </p>
            {group.items.map(({ href, label, icon: Icon }) => {
              const active = isCurrent(pathname, href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm font-bold transition-colors",
                    active
                      ? "bg-primary text-primary-foreground shadow-glow"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors",
                      active
                        ? "bg-white/20 text-primary-foreground"
                        : "bg-secondary text-muted-foreground group-hover:text-primary",
                    )}
                  >
                    <Icon className="size-4" strokeWidth={active ? 2.4 : 1.9} />
                  </span>
                  <span className="min-w-0 truncate">{label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </>
  );
}
