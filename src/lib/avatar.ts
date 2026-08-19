/**
 * What a member is allowed to put in their `image` column.
 *
 * This is a trust boundary: whatever survives here is rendered in an <img> on
 * the profile and, once they win something, on the homepage. So only what the
 * picker can legitimately produce is accepted — a small self-contained image,
 * or nothing. An arbitrary URL can't be parked in a column other people's
 * browsers will fetch.
 *
 * The picker squares and re-encodes to a 256px JPEG in the browser (see
 * `ProfileForm`), which lands around 20KB. The cap is loose enough to survive a
 * poor re-encode and tight enough that the column stays a column.
 */
const AVATAR_DATA_URL_RE = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const MAX_AVATAR_CHARS = 400_000;

/** The form's own vocabulary: "" leaves the picture alone, so an ordinary
 *  name-and-number edit never rewrites it, and "none" clears it. */
export const UNCHANGED_AVATAR = "";
export const REMOVE_AVATAR = "none";

/** `image` unset means "leave what is stored"; set means "store this". */
export type AvatarChange = { image?: string; error?: string };

export function readAvatar(raw: unknown): AvatarChange {
  const value = typeof raw === "string" ? raw : "";
  if (value === UNCHANGED_AVATAR) return {};
  if (value === REMOVE_AVATAR) return { image: "" };
  if (value.length > MAX_AVATAR_CHARS) return { error: "That picture is too big. Try a smaller one." };
  if (!AVATAR_DATA_URL_RE.test(value)) return { error: "That picture isn't a format we can store." };
  return { image: value };
}
