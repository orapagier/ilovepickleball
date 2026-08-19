# I Love Pickleball — visual design

## Subject

I Love Pickleball: an hourly court-booking site for players in Tagum
City, Davao del Norte, plus the club tournaments run on those same courts. The
site has one job — get a player from "I want to play tonight" to a held, paid
slot. Everything else is in service of that.

It is used on a phone, mostly, often standing on the court. So it is built as an
app that happens to run in a browser: a tab bar under the thumb, frosted chrome
that content scrolls under, controls big enough to hit, and a running total that
never leaves the screen while you are picking slots.

## Direction: Orchid Court

Davao is the orchid capital of the Philippines, and the waling-waling (*Vanda
sanderiana*) is its emblem: broad mauve-rose petals veined in magenta, a
chartreuse-gold throat, sitting in aubergine shade. That flower is the palette.
It is local, it is warm, and it is nobody's default sports-booking blue.

### Colour

| Token | Role |
| --- | --- |
| `primary` | Orchid magenta. Every action, link and active state. |
| `dusk` | Aubergine shade. The hero, page mastheads, the footer, live tiles. |
| `bloom` | The flower's gold throat. Live-this-minute only. |
| `background` / `card` | Near-white with a mauve cast, so a white card is its own surface. |
| `muted-foreground` | Mauve-grey, not the usual blue-grey. |

`bloom` is the one loud colour and it marks exactly one thing: something is
happening *right now*. That is the next free hour in the hero strip, the
`in_progress` badge, the "happening now" promo tile and the "you're up" banner.
It is never used for emphasis, decoration or any other state.

Two orchid blooms are lit behind the whole app from `body::before` — fixed,
low-alpha radial gradients. They exist so frosted surfaces have something to
refract; without them "glass" is just a grey box.

### Surfaces

Three layers, and they are not interchangeable:

- `dusk-panel` — the deep ground. Hero, page mastheads, footer, live cards.
- `surface-card` — opaque vellum. Everything that holds content. Depth comes
  from a tinted plum shadow and a lit top edge (`inset 0 1px 0`), not from blur.
- `glass-panel` — real `backdrop-filter`. Floating chrome only: the header, the
  tab bar, the sticky booking total, the map's Open-in-Maps chip.

Blur is expensive on a phone, so it is rationed to the handful of elements that
actually float over scrolling content. Sixty blurred cards would be sixty
dropped frames.

### Type

Two faces, three jobs:

- **Fraunces** (display) with its `SOFT`, `WONK` and `opsz` axes set per level —
  soft and wonky at headline sizes, plain at 16px, where swash forms just read
  as a typo. Warmth and authority in one face, which is what keeps an orchid
  palette from reading as juvenile.
- **Manrope** (body and UI) — geometric, round-bowled, excellent at 12px.
- Numbers are Manrope too: `.data-value` (tabular figures, tightened) for inline
  data, `.figure-display` (Fraunces, lining figures) for a figure that is the
  point of its block — a rate, a total, a step number.

The separate mono data face the previous direction used is gone. Changing
typeface mid-sentence to say "this bit is a number" was a cost with no reader
paying it.

Controls are utilities, not hand-rolled class lists: `.btn` with `btn-primary` /
`btn-outline` / `btn-danger` / `btn-on-dusk` / `btn-sm`, and `.field` with
`field-sm`. Buttons are pills; fields are 12px-radius with a soft orchid focus
halo.

### Structure

`--radius: 1rem`, and the scale runs from it. Rounded and generous is the
geometry of something you hold. Tags, filters, nav items and buttons are all
pills, so a tag never has to be told apart from a control by its corners.

Navigation is split by device rather than collapsed into a menu: a bottom tab
bar on a phone (Home / Book / Play / Bookings / You), inline pills on a laptop.
Admin and sign-out — the two destinations that don't fit five tabs — live on the
You tab, which is where anyone would look for them.

### Signature

The hero is **today's real availability**: every remaining hour, with how many
courts are still free in it, read from the same `buildAvailability` the booking
grid runs. The next hour with anything left in it is marked in gold.

It is the answer to the only question a visitor actually has — can I play
tonight? — and because it is computed rather than written, the homepage can
never disagree with the page it sends people to.

### Quality floor

Responsive to 320px, visible keyboard focus on every interactive element
(without touching border-radius, which would square a focused pill),
`prefers-reduced-motion` respected, safe-area insets honoured under the tab bar,
and both colour schemes defined as tokens. Motion is one page-load rise on the
hero, the gold pulse for live, and press states on controls — nothing scroll-
triggered.
