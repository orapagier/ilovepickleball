/**
 * CSV that Excel opens correctly.
 *
 * Two details do most of the work here. Fields are quoted per RFC 4180 — a
 * customer note containing a comma, a quote, or a newline would otherwise shift
 * every column after it. And the file leads with a UTF-8 byte-order mark,
 * because Excel on Windows assumes the local codepage without one and mangles
 * any non-ASCII name or the ₱ sign.
 */

/** Fields Excel would otherwise reinterpret: a leading =, +, - or @ makes a
 *  cell a formula. Prefixing a tab keeps the text as text. */
function deFormula(value: string): string {
  return /^[=+\-@]/.test(value) ? `\t${value}` : value;
}

function escapeField(value: unknown): string {
  if (value == null) return "";
  const raw = deFormula(String(value));
  // Quote when the field contains anything that would break the row apart, and
  // double any quotes inside it.
  return /[",\r\n\t]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

export type CsvColumn<T> = { header: string; value: (row: T) => unknown };

export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const lines = [columns.map((c) => escapeField(c.header)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => escapeField(c.value(row))).join(","));
  }
  // CRLF is what the spec says and what Excel is happiest with.
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** A CSV file response, named so it lands in Downloads as something readable. */
export function csvResponse(csv: string, filename: string): Response {
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // An export is a snapshot of live data; never let one be served twice.
      "Cache-Control": "no-store",
    },
  });
}

/** `2026-08-15` — for stamping a filename so successive exports don't collide. */
export function fileStamp(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Dates in an export are read by a human in a spreadsheet, so they go out in
 *  the business timezone rather than as UTC ISO strings. */
export function csvDateTime(date: Date | null | undefined, tz: string): string {
  if (!date) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: tz,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  // "YYYY-MM-DD HH:MM" sorts correctly as text and parses as a date in Excel.
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

/** Money as a bare decimal — a currency symbol in the cell would make Excel
 *  treat the column as text and refuse to sum it. */
export function csvMoney(cents: number): string {
  return (cents / 100).toFixed(2);
}
