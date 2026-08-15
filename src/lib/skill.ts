/**
 * Skill ratings, on the 2.0–5.5 scale pickleball already uses.
 *
 * The rungs and the words attached to them come from the club's rating matrix,
 * which lines the official USA Pickleball / DUPR / UTPR numbers up with the
 * terms players here actually say ("high intermediate", "solid 3.0"). Both are
 * kept: the number is what gets enforced, and the local term is what makes a
 * member recognise themselves in it.
 *
 * A rating is one number on a member, and a tournament's entry requirement is a
 * pair of bounds. Everything displayed about a band is derived from those bounds
 * (`formatSkillBand`) rather than stored alongside them, so what a member reads
 * on the tournament page and what `canEnterAtRating` enforces cannot drift apart.
 */

export type SkillOption = {
  value: number;
  /** The number as it is written down, e.g. "3.5". */
  label: string;
  /** What players here call this level. */
  term: string;
  /** One line, for the places that only have room for one — selects, chips. */
  blurb: string;
  /** The self-assessment proper: what someone at this level can actually do. */
  capabilities: string[];
  /** What this level is ready to enter. */
  readiness: string;
};

/**
 * The rungs an admin or member can pick, and what each one means.
 *
 * Half-steps are the convention, and the scale bottoms out at 2.0 rather than
 * 1.0 because the matrix folds 1.0–2.0 into a single "absolute beginner" band —
 * below 2.0 the distinctions are about lessons, not draws.
 */
export const SKILL_RATINGS: SkillOption[] = [
  {
    value: 2.0,
    label: "2.0",
    term: "Absolute Beginner / First-Timer",
    blurb: "Learning the rules; rallies last one to three shots",
    capabilities: [
      "Learning the court boundaries, the kitchen (non-volley zone), and the two-bounce rule.",
      "Still working on making consistent contact, serving accurately, and calling the score.",
      "Rallies are short — about one to three shots.",
    ],
    readiness: "Not ready for bracket play yet: clinics and open rec play.",
  },
  {
    value: 2.5,
    label: "2.5",
    term: "High Beginner / Novice",
    blurb: "Serves and returns land; rallies of four to six shots",
    capabilities: [
      "Serves and returns deep enough to keep a rally of four to six shots going.",
      "Knows the double-bounce rule and where the kitchen line is.",
      "Plays mostly from the baseline; slow to move up to the kitchen.",
    ],
    readiness: "Ready for novice divisions and beginner round-robins.",
  },
  {
    value: 3.0,
    label: "3.0",
    term: "Low Intermediate / Solid Rec",
    blurb: "Moves up to the kitchen and dinks, but third-shot drops are hit and miss",
    capabilities: [
      "Knows court positioning, and moves up to the kitchen line when it is right to.",
      "Can hold a basic dink rally, though the backhand dink is still a weakness.",
      "Third-shot drops land maybe 30–50% of the time.",
      "Good forehand groundstrokes; errors creep in once the pace lifts.",
    ],
    readiness: "Fits standard 3.0 brackets and social leagues.",
  },
  {
    value: 3.5,
    label: "3.5",
    term: "High Intermediate / Competitive Rec",
    blurb: "Reliable drops and drives, sustained dinking, real court coverage",
    capabilities: [
      "Controls placement, depth and trajectory on serves and returns.",
      "Third-shot drops land 50–70% of the time, and knows when to drive instead.",
      "Sustains long dink rallies, resets fast balls, and reads where opponents are going.",
      "Covers the court well and talks to their partner.",
    ],
    readiness: "A regular in 3.5 divisions and competitive local leagues.",
  },
  {
    value: 4.0,
    label: "4.0",
    term: "Advanced / Club Champion",
    blurb: "Resets under pressure, dictates pace, punishes any pop-up",
    capabilities: [
      "High success rate on third-shot drops, resets and unattackable dinks under pressure.",
      "Dictates pace and spin; spots a weak pop-up instantly and finishes the point.",
      "Rarely makes an unforced error at low to medium pace.",
    ],
    readiness: "Competes in 4.0 open and sanctioned events.",
  },
  {
    value: 4.5,
    label: "4.5",
    term: "High Advanced / Regional Competitor",
    blurb: "Turns defence into offence; speed, spin, and very few unforced errors",
    capabilities: [
      "Turns a defensive position into an offensive one without much trouble.",
      "Exceptional speed, footwork, shot selection and counter-attacking.",
      "Understands tactical matchups and partner stacking.",
    ],
    readiness: "Podiums regularly in regional 4.5+ open divisions.",
  },
  {
    value: 5.0,
    label: "5.0",
    term: "Expert / Semi-Pro",
    blurb: "Master-level execution and hand speed; near-zero unforced errors",
    capabilities: [
      "Master-level mechanics, elite hand speed, almost no unforced errors.",
      "Complete command of footwork, tactics and the mental game.",
    ],
    readiness: "Open / Pro division competitor.",
  },
  {
    value: 5.5,
    label: "5.5+",
    term: "Tour Professional / Open",
    blurb: "National tour standard",
    capabilities: [
      "Everything at 5.0, held to national tour standard.",
      "Competes at top-tier national events (PPA, APP, MLP).",
    ],
    readiness: "Pro tour.",
  },
];

/** Ratings are half-steps on a fixed scale, so anything else was made up. */
export function isValidSkillRating(value: number): boolean {
  return SKILL_RATINGS.some((r) => r.value === value);
}

/** The matrix row for a rating, or null when there isn't one. */
export function findSkillOption(rating: number | null): SkillOption | null {
  if (rating === null) return null;
  return SKILL_RATINGS.find((r) => r.value === rating) ?? null;
}

/**
 * Reads a rating out of a form field. Returns `null` for a blank field — the
 * explicit "not rated" choice — and `undefined` for something off the scale,
 * which the caller should reject rather than silently store.
 */
export function parseSkillRating(raw: FormDataEntryValue | null): number | null | undefined {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || !isValidSkillRating(n)) return undefined;
  return n;
}

/** "3.5" rather than "3.5000000001" — a rating is always a half step. */
export function formatRating(rating: number): string {
  return rating.toFixed(1);
}

/** How a member's own rating reads. */
export function formatSkillRating(rating: number | null): string {
  return rating === null ? "Not rated" : formatRating(rating);
}

/** The rating with the words that go with it — "3.5 — High Intermediate /
 *  Competitive Rec". For the places with room to say what the number means. */
export function describeSkillRating(rating: number | null): string {
  const option = findSkillOption(rating);
  if (!option) return formatSkillRating(rating);
  return `${option.label} — ${option.term}`;
}

/**
 * The one label for a band, used by the browse card, the tournament page, the
 * admin views and the CSV alike. An open-ended side is what makes "3.5+" and
 * "up to 3.0" distinct from a closed band.
 */
export function formatSkillBand(min: number | null, max: number | null): string {
  if (min === null && max === null) return "All levels";
  if (min !== null && max === null) return `${formatRating(min)}+`;
  if (min === null && max !== null) return `Up to ${formatRating(max)}`;
  if (min === max) return `${formatRating(min!)} only`;
  return `${formatRating(min!)}–${formatRating(max!)}`;
}

/** Whether a band restricts entry at all. */
export function hasSkillBand(min: number | null, max: number | null): boolean {
  return min !== null || max !== null;
}

export type SkillVerdict = { ok: true } | { ok: false; reason: "unrated" | "outside" };

/**
 * The entry rule. An unrated member is refused from a banded tournament rather
 * than waved through — the whole point of the band is that everyone in the draw
 * is known to belong in it, and "no rating" is not evidence of that.
 */
export function canEnterAtRating(
  rating: number | null,
  min: number | null,
  max: number | null,
): SkillVerdict {
  if (!hasSkillBand(min, max)) return { ok: true };
  if (rating === null) return { ok: false, reason: "unrated" };
  if (min !== null && rating < min) return { ok: false, reason: "outside" };
  if (max !== null && rating > max) return { ok: false, reason: "outside" };
  return { ok: true };
}

/** A bad pair of bounds an admin could otherwise save, e.g. min 4.0 max 3.0. */
export function skillBandError(min: number | null, max: number | null): string | null {
  if (min !== null && !isValidSkillRating(min)) return "Pick a minimum rating from the list.";
  if (max !== null && !isValidSkillRating(max)) return "Pick a maximum rating from the list.";
  if (min !== null && max !== null && min > max) {
    return "The minimum rating can't be above the maximum.";
  }
  return null;
}
