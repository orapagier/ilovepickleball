const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmtMin(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  const period = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

/** Collapses adjacent weekdays with identical hours into readable ranges. */
export function summarizeHours(hours: { weekday: number; openMin: number; closeMin: number }[]): string[] {
  const byDay = new Map<number, { openMin: number; closeMin: number }>();
  for (const h of hours) byDay.set(h.weekday, h);

  type Group = { start: number; end: number; openMin: number; closeMin: number };
  const groups: Group[] = [];
  for (let d = 0; d < 7; d++) {
    const row = byDay.get(d);
    if (!row) continue;
    const last = groups[groups.length - 1];
    if (last && last.end === d - 1 && last.openMin === row.openMin && last.closeMin === row.closeMin) {
      last.end = d;
    } else {
      groups.push({ start: d, end: d, openMin: row.openMin, closeMin: row.closeMin });
    }
  }

  return groups.map((g) => {
    const label = g.start === g.end ? WEEKDAY_NAMES[g.start] : `${WEEKDAY_NAMES[g.start]}–${WEEKDAY_NAMES[g.end]}`;
    const span =
      g.openMin === 0 && g.closeMin === 1440 ? "Open 24 hours" : `${fmtMin(g.openMin)} – ${fmtMin(g.closeMin)}`;
    return `${label}: ${span}`;
  });
}
