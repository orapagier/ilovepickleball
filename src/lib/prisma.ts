import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/* `sslmode=require` in the URL makes pg warn on every boot: it currently
   upgrades prefer/require/verify-ca to verify-full, and v9 will stop doing that.
   Asking for verified TLS through the pool config instead says the same thing
   without the ambiguous param — and leaves DATABASE_URL untouched for the Prisma
   CLI, whose engine would demand an explicit sslrootcert under verify-full. */
/* Neon closes idle server connections (and autosuspends the compute) on its own
   schedule, and a pooled socket killed from that side is only discovered when a
   query is already riding it — surfacing as a one-off ETIMEDOUT or "Connection
   terminated unexpectedly" 500. Retiring our own idle connections well before
   Neon does means the pool hands out live sockets and reconnects on demand. */
const POOL = { max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000, keepAlive: true };

function poolConfig() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return { connectionString, ...POOL };

  const url = new URL(connectionString);
  const sslmode = url.searchParams.get("sslmode");
  if (!sslmode || sslmode === "disable") return { connectionString, ...POOL };

  url.searchParams.delete("sslmode");
  return { connectionString: url.toString(), ssl: { rejectUnauthorized: true }, ...POOL };
}

const adapter = new PrismaPg(poolConfig());

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
