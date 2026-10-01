// src/lib/db.ts
//
// The postgres.js client, kept for the standalone scripts that read or write
// whole files (`migrate`, `seed`). The query layer in `data.ts` and the server
// actions in `actions.ts` use Drizzle — see `drizzle.ts` — rather than this.

import postgres from "postgres";

import { connectionString } from "./connection";

export { connectionString };

export const sql = postgres(connectionString, { ssl: false });
