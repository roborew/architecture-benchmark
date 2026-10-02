// src/lib/drizzle.ts
//
// The Drizzle client — the only connection the query layer and the server
// actions make. `POSTGRES_URL` and its `.env` bootstrap come from
// `connection.ts` so every path resolves the same connection, including the e2e
// connection string the integration setup writes into the environment before
// any test imports this.

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { connectionString } from "./connection";

const pool = new Pool({ connectionString });

/**
 * Swallow the errors `pg` emits when the server goes away underneath it.
 *
 * A `Pool` is an EventEmitter, and Node treats an `'error'` event with no
 * listener as an uncaught exception. The e2e suite drops its database with
 * `DROP … WITH FORCE` at the end of the run, which kills this pool's
 * connections while the dev server is still shutting down — so every teardown
 * printed an uncaught `terminating connection due to administrator command`
 * even though all 89 tests had passed.
 *
 * These are idle connections being closed by the server, not failed queries: a
 * query that fails still throws at its call site. Logging rather than staying
 * silent keeps a genuine connection problem visible without crashing the
 * process on the ordinary path.
 */
pool.on("error", (error) => {
  console.warn("[db] idle connection closed by the server:", error.message);
});

export const db = drizzle({ client: pool });
