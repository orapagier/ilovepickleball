import { Download } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Download link for one of the admin CSV exports.
 *
 * A plain `<a>` rather than `next/link` on purpose: the target is a route
 * handler that answers with a file, so there is no page for the router to
 * navigate to. The filename comes from the response's `Content-Disposition`,
 * which stamps it with the date — hence no `download` attribute here, which
 * would only override it with the URL's last segment.
 */
export function ExportLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
        className,
      )}
    >
      <Download className="size-3.5" />
      {children}
    </a>
  );
}
