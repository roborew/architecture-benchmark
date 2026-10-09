import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rigRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(rigRoot, "..");

const read = (p: string) => readFileSync(p, "utf8");

// The seeder image is built from `testing-rig/seeder/` only (the copy-out rule,
// plan §1/§3.2). It therefore carries *copies* of the normative schema and the
// canonical generator; these must not drift from their sources.
describe("seeder build context stays in sync with the spec", () => {
  it("has a byte-identical copy of spec/schema.sql", () => {
    expect(read(path.join(rigRoot, "seeder", "schema.sql"))).toBe(
      read(path.join(repoRoot, "spec", "schema.sql")),
    );
  });

  it("has a byte-identical copy of the canonical generator", () => {
    expect(read(path.join(rigRoot, "seeder", "generate-fixture.mjs"))).toBe(
      read(path.join(rigRoot, "src", "fixtures", "generate-fixture.mjs")),
    );
  });
});
