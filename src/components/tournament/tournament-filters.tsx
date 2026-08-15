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
 * each category to one control, and gets the platform's own picker on mobile
 * for free, which is a better list than anything drawn in CSS.
 *
 * Navigation stays URL-driven exactly as before: each change rewrites one query
 * key and keeps the rest, so the filters still narrow each other and any
 * combination is still linkable and back-button-able.
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
    <div className="flex flex-col gap-2">
      {/* One line on every width: three columns on a phone, natural widths once
          there is room for them. */}
      <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:items-end">
        {groups.map((group) => {
          const value = current[group.key] ?? "";
          const active = Boolean(value);
          return (
            <label key={group.key} className="min-w-0 sm:w-auto">
              <span className="mb-1 block truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </span>
              <span className="relative block">
                <select
                  value={value}
                  onChange={(e) => router.push(hrefWith(basePath, current, group.key, e.target.value || undefined))}
                  aria-label={group.label}
                  className={cn(
                    // `appearance-none` so the control matches the rest of the
                    // site's inputs; the chevron below replaces the native one.
                    "w-full appearance-none truncate rounded-lg border bg-background py-2 pl-2.5 pr-7 text-xs font-medium transition-colors",
                    "focus:outline-none focus:ring-2 focus:ring-primary/40 sm:w-auto sm:pl-3 sm:pr-8 sm:text-sm",
                    active
                      ? "border-primary text-primary"
                      : "border-input text-foreground hover:border-muted-foreground/50",
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
                    "pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 sm:size-4",
                    active ? "text-primary" : "text-muted-foreground",
                  )}
                />
              </span>
            </label>
          );
        })}
      </div>

      {(activeCount > 0 || note) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {note && <span>{note}</span>}
          {activeCount > 0 && (
            <Link
              href={basePath}
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              <X className="size-3" />
              Clear {activeCount === 1 ? "filter" : "filters"}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
