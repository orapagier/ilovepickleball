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
    async jwt({ token, user }) {
      // `user` is only populated on the initial sign-in, which is exactly
      // when we want to (re-)assign the role from the ADMIN_EMAILS allowlist.
      if (user?.id) {
        const email = user.email ?? "";
        const role: AppRole = isAdminEmail(email) ? "admin" : "customer";
        const dbUser = await prisma.user.upsert({
          where: { googleSub: user.id },
          update: { email, name: user.name ?? "", image: user.image ?? "", role },
          create: {
            googleSub: user.id,
            email,
            name: user.name ?? "",
            image: user.image ?? "",
            role,
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
