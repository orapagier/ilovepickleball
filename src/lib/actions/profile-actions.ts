"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth-helpers";
import { parseSkillRating } from "@/lib/skill";
import { readAvatar } from "@/lib/avatar";

export type ActionState = { error?: string; ok?: boolean };

// Philippine mobile numbers: 09XXXXXXXXX or +639XXXXXXXXX.
const PH_MOBILE_RE = /^(?:\+63|0)9\d{9}$/;

function normalizePhone(raw: string): string {
  return raw.replace(/[\s-]/g, "");
}

export async function completeRegistration(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user) redirect("/signin");

  const name = String(formData.get("name") ?? "").trim();
  const phone = normalizePhone(String(formData.get("phone") ?? "").trim());
  const callbackUrl = String(formData.get("callbackUrl") ?? "/book");

  if (name.length < 2) return { error: "Enter your complete name." };
  if (!PH_MOBILE_RE.test(phone)) {
    return { error: "Enter a valid mobile number, e.g. 09171234567." };
  }

  /* Optional on purpose: this form is the gate on booking a court, and a
     pickleball rating has nothing to do with booking one. Leaving it unset only
     costs a member entry to tournaments that set a skill band, and the join
     error says exactly that and sends them to /profile. */
  const skillRating = parseSkillRating(formData.get("skillRating"));
  if (skillRating === undefined) return { error: "Pick a skill level from the list, or leave it unset." };

  await prisma.user.update({ where: { id: user.id }, data: { name, phone, skillRating } });
  revalidatePath("/book");
  revalidatePath("/tournaments");
  revalidatePath("/profile");
  redirect(callbackUrl || "/book");
}

/**
 * Save the profile from /profile. Same fields and same rules as
 * `completeRegistration`, minus the redirect: this one is reached by a member
 * who came to change something, not by one being let through a gate, so it
 * stays put and says it saved.
 *
 * A rating changed here is not retroactive, exactly as when an admin changes it
 * — an entry already accepted into a draw stays in it. Withdrawing is a separate
 * decision with consequences for the draw.
 */
export async function updateProfile(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user) redirect("/signin?callbackUrl=/profile");

  const name = String(formData.get("name") ?? "").trim();
  const phone = normalizePhone(String(formData.get("phone") ?? "").trim());

  if (name.length < 2) return { error: "Enter your complete name." };
  if (!PH_MOBILE_RE.test(phone)) {
    return { error: "Enter a valid mobile number, e.g. 09171234567." };
  }

  const skillRating = parseSkillRating(formData.get("skillRating"));
  if (skillRating === undefined) return { error: "Pick a skill level from the list, or leave it unset." };

  const avatar = readAvatar(formData.get("image"));
  if (avatar.error) return { error: avatar.error };

  await prisma.user.update({
    where: { id: user.id },
    data: { name, phone, skillRating, ...(avatar.image === undefined ? {} : { image: avatar.image }) },
  });
  /* The rating decides which tournaments are enterable and the browse filter
     reads it, so both tournament views are stale the moment it changes. The
     picture reaches the homepage as soon as they win something, so that too. */
  revalidatePath("/profile");
  revalidatePath("/book");
  revalidatePath("/tournaments");
  revalidatePath("/");
  return { ok: true };
}
