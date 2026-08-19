/**
 * The masthead every inner page opens with: a band of dusk carrying the page's
 * name, and nothing else.
 *
 * It is a band rather than a line of text on the page background because on a
 * phone this is the top of the screen under the status bar, and an app puts
 * something there. It also gives Book, Tournaments and My bookings one shared
 * opening, so moving between them feels like moving inside one product.
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
  eyebrow,
  title,
  description,
  action,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  /** A summary row under the description — counts, filters in force, a note. */
  children?: React.ReactNode;
}) {
  return (
    <header className="dusk-panel relative">
      <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-x-8 gap-y-5 px-4 pb-9 pt-7 sm:pb-11 sm:pt-9">
        <div className="min-w-0">
          {eyebrow && <p className="eyebrow eyebrow-on-dusk">{eyebrow}</p>}
          <h1 className={`text-3xl sm:text-4xl ${eyebrow ? "mt-4" : ""}`}>{title}</h1>
          {description && (
            <div className="mt-3 max-w-2xl text-sm leading-relaxed text-dusk-foreground/75">{description}</div>
          )}
          {children && <div className="mt-5">{children}</div>}
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
