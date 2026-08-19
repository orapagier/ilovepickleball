"use client";

import { useRouter } from "next/navigation";
import { ChevronDown, X } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The browse filters, as one dropdown per category rather than a wall of pills.
 *
 * Three categories with nineteen values between them is far too many chips to
 * lay out on a phone — they wrapped into a block of rows that read as noise and
 * pushed the actual tournaments below the fold. A native `<select>` collapses
 * each category to one control, and gets the platform's own picker on a phone
 * for free, which is a better list than anything drawn in CSS.
 *
 * The controls are pills like every other control in the app, and a category in
 * force fills rose rather than merely tinting its border — on a phone held at
 * arm's length a 1px colour change is not a state.
 *
 * Navigation stays URL-driven: each change rewrites one query key and keeps the
 * rest, so the filters still narrow each other and any combination is still
 * linkable and back-button-able.
 */
export type FilterOption = { value: string; label: string };

export type FilterGroup = {
  /** The query-string key this group writes. */
  key: string;
  /** The category name, shown above the control. */
  label: string;
  /** What the unfiltered choice reads as — "All stages", "Any format". */
  allLabel: string;
  options: FilterOption[];
};

/** Rebuild the query string with one key changed, dropping empties so the
 *  unfiltered URL stays clean `/tournaments` rather than `?status=`. */
function hrefWith(
  basePath: string,
  current: Record<string, string | undefined>,
  key: string,
  value: string | undefined,
): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...current, [key]: value })) {
    if (v) params.set(k, v);
  }
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

export function TournamentFilters({
  basePath = "/tournaments",
  groups,
  current,
  note,
}: {
  basePath?: string;
  groups: FilterGroup[];
  /** The filters in force, keyed as they appear in the URL. */
  current: Record<string, string | undefined>;
  /** An aside for the row — e.g. the member's own rating next to the level
   *  filter. Null when there is nothing to say. */
  note?: string | null;
}) {
  const router = useRouter();
  const activeCount = groups.filter((g) => current[g.key]).length;

  return (
    <div className="flex flex-col gap-3">
      {/* One line on every width: three columns on a phone, natural widths once
          there is room for them. */}
      <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:items-center">
        {groups.map((group) => {
          const value = current[group.key] ?? "";
          const active = Boolean(value);
          return (
            <span key={group.key} className="relative block min-w-0 sm:w-auto">
              <select
                value={value}
                onChange={(e) => router.push(hrefWith(basePath, current, group.key, e.target.value || undefined))}
                aria-label={group.label}
                className={cn(
                  // `appearance-none` so the control matches the rest of the
                  // site's controls; the chevron below replaces the native one.
                  "w-full cursor-pointer appearance-none truncate rounded-full border py-2.5 pl-3.5 pr-8 text-xs font-bold transition-colors",
                  // The native dropdown draws options on the control's own
                  // colours in some browsers, which on a filled pill is white
                  // on white. Name them.
                  "[&>option]:bg-card [&>option]:font-medium [&>option]:text-foreground",
                  "sm:w-auto sm:pl-4 sm:pr-9 sm:text-sm",
                  active
                    ? "border-transparent bg-primary text-primary-foreground shadow-glow"
                    : "border-border bg-card text-foreground shadow-card hover:border-primary/40",
                )}
              >
                <option value="">{group.allLabel}</option>
                {group.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <ChevronDown
                aria-hidden
                className={cn(
                  "pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 sm:size-4",
                  active ? "text-primary-foreground" : "text-muted-foreground",
                )}
              />
            </span>
          );
        })}

        {activeCount > 0 && (
          <Link
            href={basePath}
            className="col-span-3 inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-2 text-xs font-bold text-primary transition-colors hover:bg-primary/10 sm:col-auto"
          >
            <X className="size-3.5" />
            Clear {activeCount === 1 ? "filter" : "filters"}
          </Link>
        )}
      </div>

      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}
