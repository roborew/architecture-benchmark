import { describe, expect, it } from "vitest";

import { formatDate } from "./format";

// The date is split rather than handed to `new Date`, which parses a bare
// ISO date as UTC and then renders it in local time — a day off for anyone
// west of Greenwich, which would make the screens and the tests disagree
// depending on where they run.

describe("formatDate", () => {
	it("renders an ISO date as day month year", () => {
		expect(formatDate("2026-09-27")).toBe("27 Sep 2026");
	});

	it("does not pad a single digit day", () => {
		expect(formatDate("2026-01-05")).toBe("5 Jan 2026");
	});

	it("handles the first and last month", () => {
		expect(formatDate("2026-01-15")).toBe("15 Jan 2026");
		expect(formatDate("2026-12-15")).toBe("15 Dec 2026");
	});
});
