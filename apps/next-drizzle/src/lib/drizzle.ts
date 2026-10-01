// src/lib/drizzle.ts
//
// The Drizzle client. `POSTGRES_URL` and its `.env` bootstrap come from
// `db.ts` so both drivers resolve the same connection — including the e2e
// connection string the integration setup writes into the environment before
// any test imports them.

import { drizzle } from "drizzle-orm/node-postgres";

import { connectionString } from "./db";

export const db = drizzle({ connection: { connectionString } });
