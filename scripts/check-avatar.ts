/* The one runnable check on what a member may store as their picture:
   `npx tsx scripts/check-avatar.ts`. It exists because every other rule in this
   app fails safe and this one fails open — a hole here is a URL of somebody
   else's choosing rendered on the homepage. */
import assert from "node:assert/strict";
import { readAvatar, REMOVE_AVATAR, UNCHANGED_AVATAR } from "../src/lib/avatar";

const jpeg = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==";

// The three things the form can legitimately say.
assert.deepEqual(readAvatar(UNCHANGED_AVATAR), {}, "empty must leave the stored picture alone");
assert.deepEqual(readAvatar(REMOVE_AVATAR), { image: "" }, "'none' must clear it");
assert.deepEqual(readAvatar(jpeg), { image: jpeg }, "a squared JPEG data URL must be stored");

// Everything else is somebody trying it on.
for (const bad of [
  "https://evil.example/pixel.gif",
  "javascript:alert(1)",
  "data:text/html;base64,PHNjcmlwdD4=",
  "data:image/svg+xml;base64,PHN2Zz4=", // scriptable, so not on the list
  `data:image/jpeg;base64,${"A".repeat(400_001)}`,
  null,
  { toString: () => jpeg },
]) {
  const out = readAvatar(bad);
  assert.equal(out.image, undefined, `must not store ${String(bad).slice(0, 40)}`);
}

console.log("avatar rules ok");
