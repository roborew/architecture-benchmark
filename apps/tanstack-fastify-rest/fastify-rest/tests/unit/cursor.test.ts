// tests/unit/cursor.test.ts
//
// The keyset cursor, ported verbatim from the reference variant along with its
// tests. spec/queries.md requires the "older" link to carry an opaque cursor
// for `(created_at, id)`. Opaque means the page does not have to know how the
// tuple is packed, so these tests pin the round-trip and the failure behaviour
// rather than the exact bytes.

import { describe, expect, it } from "vitest";

import { decodeCursor, encodeCursor } from "../../src/lib/cursor.ts";

describe("encodeCursor", () => {
  it("round-trips a timestamp and id", () => {
    const cursor = encodeCursor("2026-09-28T10:15:00.000000Z", 101);

    expect(decodeCursor(cursor)).toEqual({
      createdAt: "2026-09-28T10:15:00.000000Z",
      id: 101,
    });
  });

  it("is stable, so the same page cursor yields the same page", () => {
    // spec/queries.md requires the cursor be "stable and repeatable".
    const first = encodeCursor("2026-09-28T10:15:00.000000Z", 101);
    const second = encodeCursor("2026-09-28T10:15:00.000000Z", 101);

    expect(first).toBe(second);
  });

  it("produces a value safe to put in a query string", () => {
    const cursor = encodeCursor("2026-09-28T10:15:00.000000Z", 101);

    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encodeURIComponent(cursor)).toBe(cursor);
  });

  it("distinguishes cursors that differ only by id", () => {
    // The id is the tiebreaker for rows sharing a created_at, so dropping it
    // would make two different pages resolve to the same cursor.
    const a = encodeCursor("2026-09-28T10:15:00.000000Z", 101);
    const b = encodeCursor("2026-09-28T10:15:00.000000Z", 102);

    expect(a).not.toBe(b);
  });
});

describe("decodeCursor", () => {
  it("returns null for an absent cursor", () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor("")).toBeNull();
  });

  it("returns null for a cursor that was not produced by encodeCursor", () => {
    // A hand-edited or stale cursor must not reach the query: it would either
    // throw or, worse, silently select the wrong page. The model then reads
    // the first page instead of failing the request.
    expect(decodeCursor("not-a-cursor")).toBeNull();
    expect(decodeCursor("!!!!")).toBeNull();
  });

  it("returns null for a well-formed payload with a non-numeric id", () => {
    const forged = Buffer.from("2026-09-28T10:15:00.000000Z|abc").toString(
      "base64url",
    );

    expect(decodeCursor(forged)).toBeNull();
  });
});
