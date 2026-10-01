// src/lib/drizzle.ts
//
// The Drizzle client — the only connection the query layer and the server
// actions make. `POSTGRES_URL` and its `.env` bootstrap come from
// `connection.ts` so every path resolves the same connection, including the e2e
// connection string the integration setup writes into the environment before
// any test imports this.

import { drizzle } from "drizzle-orm/node-postgres";

import { connectionString } from "./connection";

export const db = drizzle({ connection: { connectionString } });
