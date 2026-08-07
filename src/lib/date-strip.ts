/**
 * Window math for the horizontal date strip on /book. Everything here is a day
 * offset from today, so the strip's paging logic never touches a Date.
 */

/** Largest window start that still fills the strip against the booking horizon. */
export function maxStripOffset(totalAdvanceDays: number, size: number): number {
  return Math.max(0, totalAdvanceDays - size + 1);
}

export function clampOffset(offset: number, maxOffset: number): number {
  return Math.min(Math.max(0, offset), maxOffset);
}

/**
 * Where the window sits after `selectedDiff` is picked: left alone when that day
 * is already on screen, otherwise centred on it.
 *
 * Leaving a visible selection alone is what makes the arrows usable — recentring
 * on every selection would drag the strip back under the user each time they
 * paged, and pulling the window toward the selection on every render would undo
 * an arrow press outright.
 */
export function offsetForSelection(
  selectedDiff: number,
  currentOffset: number,
  size: number,
  maxOffset: number,
): number {
  const start = clampOffset(currentOffset, maxOffset);
  if (selectedDiff >= start && selectedDiff <= start + size - 1) return start;
  return clampOffset(selectedDiff - Math.floor(size / 2), maxOffset);
}
