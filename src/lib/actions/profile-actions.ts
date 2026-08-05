"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth-helpers";

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

  await prisma.user.update({ where: { id: user.id }, data: { name, phone } });
  revalidatePath("/book");
  redirect(callbackUrl || "/book");
}
