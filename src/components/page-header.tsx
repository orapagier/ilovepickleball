/**
 * The masthead every inner page opens with: a band of dusk carrying the page's
 * name, and nothing else.
 *
 * It is a band rather than a line of text on the page background because on a
 * phone this is the top of the screen under the status bar, and an app puts
 * something there. It also gives Book, Tournaments and My bookings one shared
 * opening, so moving between them feels like moving inside one product.
 *
 * It is deliberately shallow — one line's worth of height. Only the homepage
 * gets a hero; an inner page's own first control (Book's grid, the bookings
 * list) is the thing the visitor came to reach, so the band names the page and
 * gets out of the way.
 *
 * Everything inside is set for a dark ground — a caller passing
 * `text-muted-foreground` into `description` will get an invisible line, so
 * pass plain text and let this decide the tone.
 *
 * The band closes on a gold hairline: the ball's colour, drawn once per page as
 * the line between the masthead and the page. It is the whole warm budget for
 * the band, which is why the dusk itself is now blue and teal alone.
 */
export function PageHeader({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  /** A summary row under the description — counts, filters in force, a note. */
  children?: React.ReactNode;
}) {
  return (
    <header className="dusk-panel relative">
      <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-x-8 gap-y-2 px-4 pb-4 pt-4">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl">{title}</h1>
          {description && (
            <div className="mt-1 max-w-2xl text-pretty text-xs leading-relaxed text-dusk-foreground/75 sm:text-sm">
              {description}
            </div>
          )}
          {children && <div className="mt-3">{children}</div>}
        </div>
        {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
      </div>
      <span
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-bloom/70 via-bloom/20 to-transparent"
      />
    </header>
  );
}
