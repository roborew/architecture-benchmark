// tests/unit/users.validator.test.ts
//
// The users validator's pure contract: the create/update body. The zod
// message strings are pinned verbatim against the reference variant's
// UserSchema (actions.ts) — a drift here is a client-visible change to the
// API's error contract. No database, no Express.

import { describe, expect, it } from "vitest";

import { parseUserBody } from "../../src/users/users.validator.ts";

describe("parseUserBody", () => {
  it("accepts a name and email, trimmed", () => {
    expect(
      parseUserBody({
        name: "  Robin Andrew  ",
        email: "  robin@example.test  ",
      }),
    ).toEqual({
      ok: true,
      data: { name: "Robin Andrew", email: "robin@example.test" },
    });
  });

  it("produces the reference's messages verbatim", () => {
    // An empty name/email reaches the min rule; an omitted one fails zod's own
    // type check first, exactly as the reference's FormData parse does.
    expect(parseUserBody({ name: "", email: "robin@example.test" })).toEqual({
      ok: false,
      errors: { name: ["User name is required."] },
    });
    expect(parseUserBody({ name: "a".repeat(201), email: "e@x.test" })).toEqual(
      {
        ok: false,
        errors: { name: ["User name must be 200 characters or fewer."] },
      },
    );
    // An empty email fails both the min rule and the format rule: zod
    // collects every issue in the chain, and so does the reference's parse of
    // an empty submitted field.
    expect(parseUserBody({ name: "Robin", email: "" })).toEqual({
      ok: false,
      errors: { email: ["Email is required.", "Enter a valid email address."] },
    });
    expect(parseUserBody({ name: "Robin", email: "not-an-address" })).toEqual({
      ok: false,
      errors: { email: ["Enter a valid email address."] },
    });
  });

  it("reports omitted fields exactly as the reference's FormData does", () => {
    expect(parseUserBody({})).toEqual({
      ok: false,
      errors: {
        name: ["Invalid input: expected string, received null"],
        email: ["Invalid input: expected string, received null"],
      },
    });
  });
});
