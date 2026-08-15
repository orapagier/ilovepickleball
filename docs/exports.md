# CSV exports

Admin-only spreadsheet exports of the operational data: bookings, and the three
tournament tables. Everything the facility needs for accounting, for a
registration desk, or for a printed results sheet, without anyone opening the
database.

## Where the code is

| Concern | File |
|---|---|
| CSV writing — escaping, the Excel details, the response | `src/lib/csv.ts` |
| The datasets, their columns and filters | `src/app/api/admin/export/[dataset]/route.ts` |
| The download link in the admin UI | `src/components/admin/export-link.tsx` |

## Why a route handler

The browser has to *receive a file*, and a server action can't hand it one — an
action returns data to React, so turning that into a download means shipping the
whole dataset into the client and building a blob there. A route handler answers
with `Content-Disposition: attachment` and the browser does the rest, so the
rows never enter a React tree.

The URL ends in `.csv` (`/api/admin/export/bookings.csv`) purely so the download
is named sensibly if the header is ever ignored; the route strips the suffix to
get the dataset key.

Both checks are on the request itself — signed in, and `role === "admin"` —
because a route handler is reachable directly and is not behind the
`requireAdmin()` in the admin layout.

## Datasets

| Dataset | Rows | Filters |
|---|---|---|
| `bookings` | every booking incl. tournament court blocks | `status`, `from`, `to` |
| `tournaments` | one row per tournament, with entry and match counts | `tournamentId` |
| `entries` | one row per registration, with both players' contact details | `tournamentId` |
| `matches` | one row per match, with court, window, score and winner | `tournamentId` |

`from`/`to` are `YYYY-MM-DD` in the business timezone, inclusive, resolved by the
same `rangeUtcBounds` the availability code uses — so an export "for the 15th"
covers exactly the day the admin sees in the app. A malformed date is a 400
rather than a silent export of everything, which is the failure that would
actually hurt: nobody double-checks the row count of a file they asked for.

Every dataset is capped at `MAX_ROWS` (10,000) so one request can't try to
serialise the entire history at once.

Tournament court blocks are ordinary `Booking` rows (see
[tournaments.md](tournaments.md)), so they appear in the bookings export like
anything else. The **Tournament block** column names the tournament for those
rows, which is what keeps a revenue total from quietly counting a held court as
a sale.

## Where the buttons are

- **/admin/bookings** — carries the status filter currently selected, so the file
  matches the chips above it. It is *not* capped to the 200 rows the page shows;
  the page is a browsing view, the export is for the spreadsheet.
- **/admin/tournaments** — every tournament, one row each.
- **/admin/tournaments/[id]** — entry list (the registration desk sheet: names,
  emails, phones, seeds, who still owes a fee) and results.

`ExportLink` is a plain `<a>`, not `next/link`: there is no page at the other end
for the router to navigate to.

## The Excel details

`src/lib/csv.ts` exists because "join the fields with commas" is wrong in four
specific ways, each of which produces a file that *opens* and is quietly
incorrect:

- **Quoting** per RFC 4180. A customer note containing a comma, a quote or a
  newline would otherwise shift every column after it.
- **A UTF-8 BOM.** Excel on Windows assumes the local codepage without one and
  mangles any non-ASCII name, and the ₱ sign.
- **Formula injection.** A field starting `=`, `+`, `-` or `@` is a formula to
  Excel. Prefixing a tab keeps it text. This is a security control, not a
  cosmetic one — a customer-supplied note is untrusted input that lands in a
  spreadsheet an admin opens.
- **CRLF** line endings, which is what the spec says and what Excel is happiest
  with.

Two formatting choices in the same file:

- **Timestamps go out in the business timezone**, as `YYYY-MM-DD HH:MM` — text
  that sorts correctly *and* parses as a date. A UTC ISO string would be read by
  a human as local time and be wrong by the offset.
- **Money is a bare decimal.** A currency symbol in the cell makes Excel treat
  the column as text and refuse to sum it; the currency is named in the column
  header instead.
