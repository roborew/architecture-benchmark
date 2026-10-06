// Keyset pagination cursor.
//
// spec/queries.md: "an 'older' link carrying an opaque cursor for
// `(created_at, id)`; it must be stable and repeatable (same cursor → same
// page)". Keyset rather than OFFSET so a page costs the same whether it is the
// first or the hundredth, and so an insert during paging cannot shift rows onto
// a page the reader has already seen.
//
// The tuple is packed into one base64url string because a raw
// `2026-09-28T10:15:00.000000Z|101` contains characters that would have to be
// percent-encoded in the `?cursor=` query parameter, and the contract calls the
// cursor opaque — the page should not need to know how it is packed.

export type Cursor = {
	createdAt: string;
	id: number;
};

const SEPARATOR = "|";

export function encodeCursor(createdAt: string, id: number): string {
	return Buffer.from(`${createdAt}${SEPARATOR}${id}`, "utf8").toString(
		"base64url",
	);
}

/**
 * Decodes a cursor, or returns `null` when there is nothing usable to decode.
 *
 * A malformed or hand-edited cursor yields `null` rather than throwing: the
 * page then renders the first page, which is a better outcome than a 500 for a
 * link the user may have simply edited.
 */
export function decodeCursor(value: string | null | undefined): Cursor | null {
	if (!value) return null;

	let decoded: string;

	try {
		decoded = Buffer.from(value, "base64url").toString("utf8");
	} catch {
		return null;
	}

	const separator = decoded.lastIndexOf(SEPARATOR);
	if (separator === -1) return null;

	const createdAt = decoded.slice(0, separator);
	const id = Number(decoded.slice(separator + 1));

	if (!createdAt || !Number.isInteger(id)) return null;

	return { createdAt, id };
}
