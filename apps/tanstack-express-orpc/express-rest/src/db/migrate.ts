// src/db/migrate.ts
//
// Applies the normative schema (spec/schema.sql) to the database named by
// POSTGRES_URL. Same file the test lifecycle applies, so dev and test
// databases can never drift apart.

import { requirePostgresUrl } from "../config/env.ts";
import { createConnection } from "./connection.ts";
import { schemaPath } from "./spec-dir.ts";

const sql = createConnection(requirePostgresUrl());

try {
  await sql.begin(async (tx) => {
    await tx.file(schemaPath);
  });
  console.log("Schema applied successfully");
} finally {
  await sql.end();
}
