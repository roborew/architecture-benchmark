// src/db/migrate.ts
//
// Applies the canonical schema (spec/schema.sql) to the configured database.
//
// Every statement in that file runs in one batch: `pg` sends a multi-statement
// string with no parameters using the simple query protocol, which is what lets
// them share a single round trip. The schema contains no placeholders, so there
// is nothing to bind and no way for a statement to be parameterised by accident.

import { readFileSync } from "node:fs";

import { Client } from "pg";

import { connectionString } from "@/lib/connection";

import { schemaPath } from "./spec-dir";

const client = new Client({ connectionString });

try {
  await client.connect();
  await client.query(readFileSync(schemaPath, "utf8"));

  console.log("Schema applied successfully");
} finally {
  await client.end();
}
