// tests/unit/projects.validator.test.ts
//
// The projects validator's pure contract: the create/update body. The zod
// message strings are pinned verbatim against the reference variant's
// ProjectSchema (actions.ts) — a drift here is a client-visible change to the
// API's error contract. No database, no Express.

import { describe, expect, it } from "vitest";

import { parseProjectBody } from "../../src/projects/projects.validator.ts";

describe("parseProjectBody", () => {
  it("accepts a name and description, trimmed", () => {
    expect(
      parseProjectBody({
        name: "  Website redesign  ",
        description: "  A refresh  ",
      }),
    ).toEqual({
      ok: true,
      data: { name: "Website redesign", description: "A refresh" },
    });
  });

  it("produces the reference's name messages verbatim", () => {
    // An empty name reaches the min rule; an omitted one fails zod's own type
    // check first, exactly as the reference's FormData parse does.
    expect(parseProjectBody({ name: "", description: "d" })).toEqual({
      ok: false,
      errors: { name: ["Project name is required."] },
    });
    expect(parseProjectBody({ name: "  ", description: "d" })).toEqual({
      ok: false,
      errors: { name: ["Project name is required."] },
    });
    expect(
      parseProjectBody({ name: "a".repeat(201), description: "d" }),
    ).toEqual({
      ok: false,
      errors: { name: ["Project name must be 200 characters or fewer."] },
    });
  });

  it("requires a description, exactly as the reference's schema does", () => {
    // The reference's ProjectSchema does not preprocess description, so an
    // omitted field is a type failure — not silently an empty description.
    expect(parseProjectBody({ name: "Website redesign" })).toEqual({
      ok: false,
      errors: {
        description: ["Invalid input: expected string, received null"],
      },
    });
    expect(parseProjectBody({ name: "n", description: "" })).toEqual({
      ok: true,
      data: { name: "n", description: "" },
    });
  });
});
