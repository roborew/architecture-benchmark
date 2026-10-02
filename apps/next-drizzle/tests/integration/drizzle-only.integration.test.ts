import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// The app is mid-migration away from raw SQL, and raw SQL is easy to reintroduce
// by accident: a template literal that happens to produce the right answer reads
// exactly like a deliberate one. These assertions fail the moment a query layer
// reaches for the postgres.js `sql` client again, which is the whole point — the
// Drizzle query builder should be the only way a page reads the database.

// Resolved from the app root rather than from this file's location, so the
// guard keeps pointing at the query layer if the test ever moves.
const libDirectory = path.join(process.cwd(), "src", "lib");

/** The files that make up the request-time data path. */
const QUERY_LAYER = ["data.ts", "actions.ts"] as const;

function read(name: string): string {
  return readFileSync(path.join(libDirectory, name), "utf8");
}

/**
 * The postgres.js import, however it is spelled.
 *
 * `drizzle-orm`'s own `sql` tag is a legitimate escape hatch for an expression
 * Drizzle has no helper for, and is used deliberately above. It is the *client*
 * that must not come back.
 */
const POSTGRES_CLIENT =
  /import\s*\{[^}]*\bsql\b[^}]*\}\s*from\s*["']\.\/db["']/;

describe("the query layer uses Drizzle", () => {
  it.each(QUERY_LAYER)("%s does not import the postgres.js client", (file) => {
    expect(read(file)).not.toMatch(POSTGRES_CLIENT);
  });

  it.each(QUERY_LAYER)("%s gets its client from the Drizzle module", (file) => {
    expect(read(file)).toMatch(/from\s*["']\.\/drizzle["']/);
  });
});
