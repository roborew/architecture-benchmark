// src/lib/connection-string.ts
//
// Pure helpers for reading a Postgres connection string.
//
// Deliberately side-effect free — no `.env` loading, no eager `POSTGRES_URL`
// read. `src/lib/connection.ts` builds the live connection string from these,
// but the e2e database lifecycle also needs them, and it runs *before* the
// integration setup has repointed `POSTGRES_URL` at the e2e database. Importing
// the live module from there would freeze the developer's URL into the query
// layer, so the string helpers have to be importable on their own.

/**
 * Query parameters that belong to a Prisma-style URL and mean nothing to Postgres.
 *
 * `?schema=public` names the Prisma *client's* search path. It is not a libpq
 * connection option, so `postgres.js` and `node-postgres` both forward it to the
 * server as a startup parameter and the connection is refused outright with
 * `unrecognized configuration parameter "schema"` — before a single test runs.
 *
 * The schema is `public` either way, so dropping it changes nothing about where
 * the tables live. The URL is shared across the app variants in this repo, so it
 * is stripped here rather than by editing each variant's (git-ignored) `.env`.
 */
const PRISMA_ONLY_PARAMS = ["schema"];

/** A connection string with any driver-foreign query parameters removed. */
export function normaliseConnectionString(raw: string): string {
  const url = new URL(raw);

  for (const param of PRISMA_ONLY_PARAMS) {
    url.searchParams.delete(param);
  }

  return url.toString();
}

/**
 * Connection string for the e2e database: the developer's `POSTGRES_URL` with
 * only the database name swapped, so both live on the same server with the same
 * credentials.
 */
export function e2eDatabaseUrl(base: string, database: string): string {
  const url = new URL(normaliseConnectionString(base));
  url.pathname = `/${database}`;

  return url.toString();
}
