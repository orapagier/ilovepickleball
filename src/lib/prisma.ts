import net from "node:net";

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
   terminated unexpectedly" 500. So `idleTimeoutMillis` retires our sockets
   before Neon can, and the pool hands out live ones.

   It is a tradeoff in both directions, though: every reconnect is a fresh TCP
   and TLS handshake to us-east-1, and a handshake is precisely what a flaky
   link drops. Retiring after 30s had a dev session reconnecting on nearly every
   page render, putting each one at the mercy of the network. Two minutes is
   still comfortably inside Neon's five-minute idle window and cuts the number
   of handshakes several-fold. `withDbRetry` below covers the ones that still
   go wrong. */
const POOL = { max: 10, idleTimeoutMillis: 120_000, connectionTimeoutMillis: 10_000, keepAlive: true };

/* Node enables Happy Eyeballs by default and gives each candidate address only
   250ms to complete its handshake before racing the next one. Neon's endpoint
   resolves to three A records plus three AAAA records we have no route to, and
   the round trip to us-east-1 is ~260-380ms from here — so the winning SYN-ACK
   usually lands just after Node has already moved on. It burns through every
   address and reports ETIMEDOUT in ~750ms, intermittently, for a database that
   is perfectly reachable. Give each attempt room for one honest round trip. */
net.setDefaultAutoSelectFamilyAttemptTimeout(2_000);

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

/* ------------------------------------------------------------------ *
 * Surviving a blip
 * ------------------------------------------------------------------ */

/**
 * Postgres error codes that mean "the query never ran", not "the query failed".
 * Prisma reports these as `PrismaClientKnownRequestError`, which is why a
 * dropped connection surfaces looking exactly like a constraint violation.
 */
const RETRYABLE_PRISMA_CODES = new Set(["P1001", "P1002", "P1008", "P1017", "P2024"]);

/** Socket-level failures, as seen on the `cause` chain the pg adapter attaches. */
const RETRYABLE_SOCKET_CODES = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "EPIPE",
  "EAI_AGAIN",
]);

/* pg reports pool and handshake failures as plain `Error`s with no code, so
   the message is the only thing left to match on. Kept narrow deliberately:
   these three strings are pg's own wording for "never got a usable socket". */
const RETRYABLE_MESSAGES = [
  /connection terminated/i,
  /timeout exceeded when trying to connect/i,
  /server has closed the connection/i,
];

/** Whether an error is the network giving out rather than the query being wrong. */
function isTransientConnectionError(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e instanceof Error && depth < 5; e = e.cause, depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && (RETRYABLE_PRISMA_CODES.has(code) || RETRYABLE_SOCKET_CODES.has(code))) {
      return true;
    }
    if (RETRYABLE_MESSAGES.some((re) => re.test(e.message))) return true;
  }
  return false;
}

/**
 * Run a read again if the connection — not the query — was what failed.
 *
 * The database lives a continent away and the link to it is not always there.
 * A dropped TCP handshake used to take a whole page down with a 500 that named
 * `findUnique` as the culprit, which sent you looking at the query; the query
 * was always fine. One retry covers the overwhelming majority of these, because
 * the pool opens a *new* socket for it and the bad one is already gone.
 *
 * **Reads only, and never inside `$transaction`.** A retried write could apply
 * twice, and a retried statement inside a transaction would run on a different
 * connection — outside the transaction it believes it is in. Wrap the data
 * loaders, not the mutations.
 */
export async function withDbRetry<T>(read: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await read();
    } catch (error) {
      if (attempt >= attempts || !isTransientConnectionError(error)) throw error;
      /* Backs off a little so a Neon compute that is still waking has a moment
         to finish, without turning a page render into a multi-second stall. */
      await new Promise((resolve) => setTimeout(resolve, attempt * 250));
    }
  }
}
