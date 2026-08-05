import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import type { AppRole } from "@/types/next-auth";

export type SessionUser = {
  id: string;
  role: AppRole;
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

/** For Server Components/pages: returns the signed-in user, or null. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  return session?.user ?? null;
}

/** For Server Components/pages: redirects to sign-in if not authenticated. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/signin");
  return user;
}

/** For Server Components/pages: redirects home if not an admin. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/");
  return user;
}

export type ProfileCompletion = { name: string; phone: string; complete: boolean };

/** Google OAuth never supplies a mobile number, so booking requires a separate
 *  registration step (see /register) that collects a complete name + mobile
 *  number before a customer's first reservation. */
export async function getProfileCompletion(userId: string): Promise<ProfileCompletion> {
  const dbUser = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, phone: true } });
  const name = dbUser?.name?.trim() ?? "";
  const phone = dbUser?.phone?.trim() ?? "";
  return { name, phone, complete: name.length > 0 && phone.length > 0 };
}
