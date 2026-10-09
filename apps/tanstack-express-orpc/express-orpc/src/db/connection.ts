// src/db/connection.ts
//
// The Postgres connection. postgres.js connects lazily — the instance is cheap
// to create and only reaches the server on the first query — so building one
// per app (rather than a module singleton) keeps `createApp` self-contained
// and lets tests point the app at a database of their choosing.

import postgres from "postgres";

export type Db = postgres.Sql;

export function createConnection(connectionString: string): Db {
  return postgres(connectionString, { ssl: false });
}
