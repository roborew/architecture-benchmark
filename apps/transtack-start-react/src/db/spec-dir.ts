// src/db/spec-dir.ts
//
// The normative spec lives at the repo root (`spec/`), not inside the app, so
// both `migrate.ts` and `seed.ts` resolve it the same way. Walking up until we
// find `spec/schema.sql` keeps this correct regardless of where the db scripts
// sit in `src/`.

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MARKER = path.join("spec", "schema.sql");

function findSpecRoot(from: string): string {
  let directory = from;

  // Stop at the filesystem root; `path.dirname("/") === "/"` would loop forever.
  for (;;) {
    if (existsSync(path.join(directory, MARKER))) {
      return directory;
    }

    const parent = path.dirname(directory);
    if (parent === directory) {
      throw new Error(
        `Could not locate the spec directory: no ${MARKER} found in any parent of ${from}`,
      );
    }
    directory = parent;
  }
}

export const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path to the repo-root `spec/` directory. */
export const specDirectory = path.join(findSpecRoot(currentDirectory), "spec");

/** Absolute path to `spec/schema.sql`. */
export const schemaPath = path.join(specDirectory, "schema.sql");

/** Absolute path to `spec/snapshots/`. */
export const snapshotsDirectory = path.join(specDirectory, "snapshots");
