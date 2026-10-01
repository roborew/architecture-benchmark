import { describe, expect, it } from "vitest";

import {
  PAGE_SIZES,
  DEFAULT_PAGE_SIZE,
  formatRange,
  pageRange,
  parsePage,
  parsePageSize,
} from "./pagination";

// The workspace list's summary line said "Showing 1-4 of 1000" on every page,
// because the start was hardcoded to 1 and the end was the current page's row
// count rather than an absolute position. These tests pin the arithmetic that
// makes the range describe where the reader actually is.

describe("pageRange", () => {
  it("describes the first page", () => {
    expect(pageRange({ page: 1, size: 10, total: 6 })).toEqual({
      from: 1,
      to: 6,
      total: 6,
    });
  });

  it("describes a full middle page", () => {
    expect(pageRange({ page: 2, size: 10, total: 25 })).toEqual({
      from: 11,
      to: 20,
      total: 25,
    });
  });

  it("describes a partial last page", () => {
    // 23 rows at 10 per page: the third page holds three, not ten.
    expect(pageRange({ page: 3, size: 10, total: 23 })).toEqual({
      from: 21,
      to: 23,
      total: 23,
    });
  });

  it("never runs past the end on an exact multiple", () => {
    expect(pageRange({ page: 2, size: 5, total: 10 })).toEqual({
      from: 6,
      to: 10,
      total: 10,
    });
  });

  it("describes the large case from the bug report", () => {
    expect(pageRange({ page: 3, size: 4, total: 1000 })).toEqual({
      from: 9,
      to: 12,
      total: 1000,
    });
  });

  it("reports an empty range when nothing matches", () => {
    expect(pageRange({ page: 1, size: 10, total: 0 })).toEqual({
      from: 0,
      to: 0,
      total: 0,
    });
  });

  it("clamps a page number past the end rather than reporting nonsense", () => {
    // A hand-edited ?page=99 must not render "Showing 981-1000" over a page
    // holding three rows.
    const range = pageRange({ page: 99, size: 10, total: 23 });

    expect(range.from).toBeLessThanOrEqual(range.total);
    expect(range.to).toBe(range.total);
  });
});

describe("formatRange", () => {
  it("renders the full list", () => {
    expect(
      formatRange({ from: 1, to: 6, total: 6 }),
    ).toBe("Showing 1-6 of 6 tasks");
  });

  it("renders a middle page", () => {
    expect(
      formatRange({ from: 11, to: 20, total: 25 }),
    ).toBe("Showing 11-20 of 25 tasks");
  });

  it("uses the singular for a single matching task", () => {
    expect(formatRange({ from: 1, to: 1, total: 1 })).toBe(
      "Showing 1-1 of 1 task",
    );
  });

  it("renders an empty result rather than a reversed range", () => {
    expect(formatRange({ from: 0, to: 0, total: 0 })).toBe(
      "Showing 0 of 0 tasks",
    );
  });

  it("mentions that filters narrowed the result", () => {
    expect(
      formatRange({ from: 1, to: 2, total: 2, filtered: true }),
    ).toBe("Showing 1-2 of 2 tasks matching your filters");
  });
});

describe("parsePageSize", () => {
  it("accepts every offered size", () => {
    for (const size of PAGE_SIZES) {
      expect(parsePageSize(String(size))).toBe(size);
    }
  });

  it("defaults when absent", () => {
    expect(parsePageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
    expect(parsePageSize("")).toBe(DEFAULT_PAGE_SIZE);
  });

  it("falls back for an unsupported size", () => {
    // A page size is a query bound, so an arbitrary value must not reach the
    // LIMIT: ?size=100000 would pull the whole table into one page.
    expect(parsePageSize("100000")).toBe(DEFAULT_PAGE_SIZE);
    expect(parsePageSize("abc")).toBe(DEFAULT_PAGE_SIZE);
    expect(parsePageSize("-5")).toBe(DEFAULT_PAGE_SIZE);
    expect(parsePageSize("0")).toBe(DEFAULT_PAGE_SIZE);
  });

  it("keeps the default at or below the spec's 25-row bound", () => {
    // spec/queries.md bounds a task page at 25 rows; offering more as an
    // explicit choice is fine, but the default must not exceed it.
    expect(DEFAULT_PAGE_SIZE).toBeLessThanOrEqual(25);
  });

  it("offers a small size, so paging is reachable with the test fixture", () => {
    // The correctness fixture has six tasks, so the smallest offered size has
    // to leave more than one page.
    expect(Math.min(...PAGE_SIZES)).toBeLessThan(6);
  });
});

describe("parsePage", () => {
  it("reads a positive integer", () => {
    expect(parsePage("3")).toBe(3);
  });

  it("defaults to the first page when absent or nonsense", () => {
    expect(parsePage(undefined)).toBe(1);
    expect(parsePage("")).toBe(1);
    expect(parsePage("abc")).toBe(1);
    expect(parsePage("0")).toBe(1);
    expect(parsePage("-2")).toBe(1);
    expect(parsePage("2.5")).toBe(1);
  });

  it("defaults to the first page when the cursor is gone", () => {
    // Page 2 without a cursor is the first page of results, whatever the
    // number in the URL claims; the range must describe what is on screen.
    expect(parsePage("4", { hasCursor: false })).toBe(1);
    expect(parsePage("4", { hasCursor: true })).toBe(4);
  });
});
