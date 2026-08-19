import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { prisma } from "@/lib/prisma";
import type { AppRole } from "@/types/next-auth";

function isAdminEmail(email: string): boolean {
  const admins = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(email.trim().toLowerCase());
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: "jwt" },
  pages: { signIn: "/signin" },
  callbacks: {
    async jwt({ token, user, account }) {
      // `user` is only populated on the initial sign-in, which is exactly
      // when we want to sync the row against the ADMIN_EMAILS allowlist.
      if (user?.email) {
        const email = user.email;
        // ADMIN_EMAILS bootstraps the first admin; after that admins are made
        // in /admin/users and live only in the database. So the allowlist may
        // promote, never demote — re-deriving the role here would strip access
        // from every admin granted through the UI the next time they sign in.
        const promote: AppRole | null = isAdminEmail(email) ? "admin" : null;
        // Auth.js deliberately hands this callback a *freshly generated UUID*
        // as `user.id` on every sign-in — Google's stable identifier arrives as
        // `account.providerAccountId`. Matching the row on `user.id` therefore
        // never hit an existing user, fell through to `create`, and threw
        // P2002 against the unique email for anyone signing in a second time.
        // Match on email (the identity ADMIN_EMAILS is keyed on anyway) and
        // keep the stored sub corrected as people sign back in.
        // The last-resort UUID only matters for the unique column; the row is
        // located by email either way.
        const googleSub = account?.providerAccountId ?? user.id ?? crypto.randomUUID();
        // `name`/`phone`/`image` are user-owned once set via the registration
        // and profile forms (see /register, /profile) — don't let a repeat
        // Google sign-in silently overwrite what the customer entered there.
        // The Google avatar is a starting value on `create`, nothing more.
        const dbUser = await prisma.user.upsert({
          where: { email },
          update: { googleSub, ...(promote ? { role: promote } : {}) },
          create: {
            googleSub,
            email,
            name: user.name ?? "",
            image: user.image ?? "",
            role: promote ?? "customer",
          },
        });
        token.uid = dbUser.id;
        token.role = dbUser.role as AppRole;
      }
      return token;
    },
    async session({ session, token }) {
      const uid = token.uid;
      const role = token.role;
      if (session.user && typeof uid === "string") {
        session.user.id = uid;
        session.user.role = typeof role === "string" ? (role as AppRole) : "customer";
      }
      return session;
    },
  },
});
