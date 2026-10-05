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

/** A connection string with driver-foreign query parameters removed. */
export function normaliseConnectionString(raw: string): string {
  const url = new URL(raw);

  // `?schema=public` is not a libpq connection option, and both postgres.js and
  // node-postgres forward any parameter they do not recognise to the server as a
  // startup parameter — which Postgres rejects with `unrecognized configuration
  // parameter` (42704). The schema is `public` either way, so dropping it changes
  // nothing about where the tables live.
  url.searchParams.delete("schema");

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
