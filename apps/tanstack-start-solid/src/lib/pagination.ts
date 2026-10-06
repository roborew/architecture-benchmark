// Workspace list paging arithmetic.
//
// Extracted from the page because it is pure and easy to get subtly wrong: the
// summary line once read "Showing 1-4 of 1000" on every page, since the start
// was hardcoded to 1 and the end was the current page's row count rather than
// an absolute position.
//
// The data itself is fetched by keyset cursor, which deliberately carries no
// offset — the page number is display state alongside it, so the range can
// describe where the reader is without the query knowing an OFFSET.

/**
 * Page sizes the list offers.
 *
 * `5` is the smallest on purpose: the correctness fixture holds six tasks, so a
 * larger smallest size would leave the fixture unable to reach a second page
 * and the keyset paging untestable end to end.
 */
export const PAGE_SIZES = [5, 10, 25, 50] as const;

export const DEFAULT_PAGE_SIZE = 10;

export type PageRange = {
	from: number;
	to: number;
	total: number;
};

/** The absolute positions the current page occupies within `total` results. */
export function pageRange({
	page,
	size,
	total,
}: {
	page: number;
	size: number;
	total: number;
}): PageRange {
	if (total <= 0) return { from: 0, to: 0, total: 0 };

	const from = (page - 1) * size + 1;
	const to = page * size;

	// A page number past the end — a hand-edited URL, or a page that shrank
	// because rows were deleted — must not report a range beyond the data.
	if (from > total) return { from: total, to: total, total };

	return { from, to: Math.min(to, total), total };
}

export function formatRange({
	from,
	to,
	total,
	filtered = false,
}: PageRange & { filtered?: boolean }): string {
	if (total === 0) return "Showing 0 of 0 tasks";

	const noun = total === 1 ? "task" : "tasks";

	return (
		`Showing ${from}-${to} of ${total} ${noun}` +
		(filtered ? " matching your filters" : "")
	);
}

/**
 * Resolves the requested page size.
 *
 * Only the offered sizes are accepted, and anything else falls back to the
 * default: this value becomes a query LIMIT, so `?size=100000` must not be able
 * to pull an entire table into one page.
 */
export function parsePageSize(value: string | undefined | null): number {
	const parsed = Number(value);

	if (!Number.isInteger(parsed)) return DEFAULT_PAGE_SIZE;

	return (PAGE_SIZES as readonly number[]).includes(parsed)
		? parsed
		: DEFAULT_PAGE_SIZE;
}

/**
 * Resolves the page number for display.
 *
 * Without a cursor there is no second page to be on — the query has returned
 * the first page of results whatever the URL claims — so the number resets to
 * 1. That keeps the summary line describing what is actually on screen.
 */
export function parsePage(
	value: string | undefined | null,
	{ hasCursor = true }: { hasCursor?: boolean } = {},
): number {
	if (!hasCursor) return 1;

	const parsed = Number(value);

	return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}
