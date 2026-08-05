import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

type Tint = "primary" | "success" | "warning" | "accent";

const TINTS: Record<Tint, string> = {
  primary: "bg-primary/10 text-primary",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  accent: "bg-accent text-accent-foreground",
};

export function StatCard({
  icon: Icon,
  label,
  tag,
  value,
  caption,
  trendPct,
  tint,
}: {
  icon: LucideIcon;
  label: string;
  tag: string;
  value: string;
  caption: string;
  /** Omit for a plain caption; pass a number to show it as a "vs last period" delta. */
  trendPct?: number;
  tint: Tint;
}) {
  return (
    <div className="surface-card flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-muted-foreground">
          {label} <span className="text-xs text-muted-foreground/70">/ {tag}</span>
        </p>
        <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", TINTS[tint])}>
          <Icon className="size-4" />
        </span>
      </div>
      <p className="font-display text-3xl font-bold">{value}</p>
      {trendPct === undefined ? (
        <p className="text-xs text-muted-foreground">{caption}</p>
      ) : (
        <p
          className={cn(
            "flex items-center gap-1 text-xs font-medium",
            trendPct >= 0 ? "text-success" : "text-destructive",
          )}
        >
          {trendPct >= 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
          {trendPct >= 0 ? "+" : ""}
          {Math.round(trendPct)}% {caption}
        </p>
      )}
    </div>
  );
}
