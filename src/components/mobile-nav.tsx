"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The header's nav on a phone, behind one button.
 *
 * There are up to seven destinations once a member signs in and an admin is
 * looking, which is more than fits across a phone — laid out inline they wrapped
 * onto a second line and pushed the page down. Collapsing them into a sheet
 * gives the header a fixed height at every width and gives each destination a
 * full-width tap target, which is a better one than a 12px-tall text link.
 *
 * The auth control is passed in as `children` rather than rebuilt here: it is a
 * server-action form, and handing it down as a slot keeps it server-rendered
 * instead of dragging the auth actions into the client bundle.
 */
export type NavLink = { href: string; label: string };

export function MobileNav({ links, children }: { links: NavLink[]; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  /* Any navigation closes the sheet. Each link closes it on click already, so
     this is only for the routes the click handler can't see — the back button,
     mostly. Adjusting during render rather than in an effect is React's own
     answer for state derived from a changing value: it re-renders before
     anything paints, instead of flashing the open sheet on the new page. */
  const [pathAtRender, setPathAtRender] = useState(pathname);
  if (pathname !== pathAtRender) {
    setPathAtRender(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? "Close menu" : "Open menu"}
        className="-mr-1 flex size-10 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-accent md:hidden"
      >
        {open ? <X className="size-5" /> : <Menu className="size-5" />}
      </button>

      {open && (
        <>
          {/* Tapping anywhere off the sheet closes it — the expected way out on
              a phone, where there is no Escape key. */}
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-30 cursor-default bg-foreground/20 md:hidden"
          />
          {/* Positioned against the header, which is `relative`. */}
          <nav className="absolute inset-x-0 top-full z-40 border-b border-border bg-background shadow-lg md:hidden">
            <ul className="flex flex-col p-2">
              {links.map((link) => {
                const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
                return (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "block rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                        active ? "bg-primary/10 text-primary" : "text-foreground hover:bg-accent",
                      )}
                    >
                      {link.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="border-t border-border p-3">{children}</div>
          </nav>
        </>
      )}
    </>
  );
}
