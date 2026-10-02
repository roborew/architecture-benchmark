import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// The app and its test harness talk to Postgres through exactly one driver:
// `pg` (node-postgres). That is what Drizzle's node-postgres adapter wraps, so
// having the postgres.js package alongside it meant two clients, two dialects
// and two ways for a connection to behave.
//
// Raw SQL is easy to reintroduce by accident — a template literal that returns
// the right answer reads exactly like a deliberate one — so this fails the
// moment anything imports the other driver again.

const appRoot = process.cwd();

/** Directories whose source must not reach for the other driver. */
const SCANNED = ["src", "tests", "scripts"];

/** The import specifiers that mean postgres.js. */
const POSTGRES_JS = /from\s*["']postgres["']|require\(\s*["']postgres["']\s*\)/;

function* sourceFiles(directory: string): Generator<string> {
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);

    if (statSync(full).isDirectory()) {
      yield* sourceFiles(full);
    } else if (/\.(ts|tsx|mjs)$/.test(entry)) {
      yield full;
    }
  }
}

describe("pg is the only Postgres driver", () => {
  it("has no source file importing postgres.js", () => {
    const offenders: string[] = [];

    for (const directory of SCANNED) {
      const root = path.join(appRoot, directory);

      for (const file of sourceFiles(root)) {
        if (POSTGRES_JS.test(readFileSync(file, "utf8"))) {
          offenders.push(path.relative(appRoot, file));
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("does not declare the postgres.js dependency", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(appRoot, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(manifest.dependencies?.postgres).toBeUndefined();
    expect(manifest.devDependencies?.postgres).toBeUndefined();
  });

  it("still declares pg, which is what the app actually uses", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(appRoot, "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };

    expect(manifest.dependencies?.pg).toBeDefined();
  });
});
