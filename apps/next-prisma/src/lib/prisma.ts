import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = global as unknown as {
  prisma: PrismaClient | undefined;
};

// Next.js loads `.env` automatically, but standalone scripts (migrate, seed) and
// the Vitest `setupFiles` entry that repoints this process at the e2e database
// do not. Load it here for the same reason `db.ts` does, so both query layers
// resolve the same connection string from the same place.
const envPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".env",
);
if (existsSync(envPath) && !process.env.POSTGRES_URL) {
  process.loadEnvFile(envPath);
}

// `DATABASE_URL` is the name Prisma tooling expects, but this project ships
// `POSTGRES_URL`, and the integration suite deliberately overrides *that* one to
// repoint this process at the e2e database. It therefore takes precedence: were
// `DATABASE_URL` to win, a developer who added it to `.env` would silently point
// every integration test back at the database `assertNotDevDatabase` exists to
// protect.
const baseConnectionString =
  process.env.POSTGRES_URL ?? process.env.DATABASE_URL;

if (!baseConnectionString) {
  throw new Error(
    "Missing database connection string: set POSTGRES_URL in .env",
  );
}

/**
 * Pin the connection's session timezone to UTC.
 *
 * Every timestamp in the schema is `timestamptz` and every fixture stores the
 * ISO-Z form, so the instant in the database is the one that matters. The
 * adapter does not hand back that instant: it decodes the value in the
 * *server's* zone, so on a Europe/London box a row stored as 08:00Z arrives as
 * a `Date` for 09:00Z — a whole hour late, and a different hour on every
 * machine that is not on UTC. On a server east of Greenwich the same row would
 * arrive an hour early instead.
 *
 * Forcing the session zone to UTC makes the decode match the instant stored, so
 * `toISOString()` is the same string on every machine. It is set here rather
 * than per-query because it is a property of the connection, and it applies
 * before any adapter decoding happens.
 *
 * Merged into the existing query string because `POSTGRES_URL` already carries
 * a Prisma-style `?schema=public`, and this must not clobber it.
 */
function withUtcSession(connectionString: string): string {
  const url = new URL(connectionString);
  const options = url.searchParams.get("options");

  url.searchParams.set(
    "options",
    options ? `${options} -c timezone=UTC` : "-c timezone=UTC",
  );

  return url.toString();
}

const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({
      connectionString: withUtcSession(baseConnectionString),
    }),
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
