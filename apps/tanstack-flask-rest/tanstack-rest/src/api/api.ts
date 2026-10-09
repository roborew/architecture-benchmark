// src/api/api.ts
//
// How the SPA talks to the server — the shared half of the api layer.
//
// Every request goes through `requestJson` so the base URL, the error
// envelope, and the JSON handling are decided in exactly one place. The
// per-feature modules (projects, tasks, users, comments, dashboard) build on
// these pieces and own their endpoints; nothing outside `src/api/` uses fetch
// directly.
//
// Reads build query params from plain filter objects; the API treats an
// absent param and an empty one the same way, so absent filters are simply
// omitted. Mutations send the form's fields as a JSON body, passing them
// through untouched: the server owns every normalisation rule (an empty
// assignee means "unassigned", a numeric string is a row id), so the client
// cannot disagree with itself about how a value is spelled.

/** Where the Flask API lives. Overridable per environment (e2e points it at its own server). */
export const API_URL: string =
	import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * A failure the API reported deliberately.
 *
 * `message` is the user-visible string from the API's `{ error }` envelope;
 * `errors` is the field → messages map a 400 carries, keyed exactly as the
 * API's validators key it. A network-level failure (fetch itself rejecting)
 * is not an ApiError — there is no status to report, only the browser's
 * generic message.
 */
export class ApiError extends Error {
	readonly status: number;
	readonly errors: Record<string, string[]>;

	constructor(
		status: number,
		message: string,
		errors: Record<string, string[]>,
	) {
		super(message);
		this.name = "ApiError";
		this.status = status;
		this.errors = errors;
	}
}

/** Every request, and the one place the error envelope is parsed. */
export async function requestJson<T>(
	path: string,
	init?: RequestInit,
): Promise<T> {
	const response = await fetch(`${API_URL}${path}`, init);

	if (!response.ok) {
		// The API's error envelope is { error, errors? }, but a proxy or a crash
		// can hand back anything; the status is the only guaranteed fact.
		let message = `Request failed with ${response.status}`;
		let errors: Record<string, string[]> = {};

		try {
			const body = (await response.json()) as {
				error?: string;
				errors?: Record<string, string[]>;
			};
			if (body && typeof body.error === "string") {
				message = body.error;
			}
			if (body?.errors && typeof body.errors === "object") {
				errors = body.errors;
			}
		} catch {
			// Not JSON — keep the status-based message.
		}

		throw new ApiError(response.status, message, errors);
	}

	return response.json() as Promise<T>;
}

/**
 * Builds a query string from defined values only.
 *
 * `undefined`, `null` and `""` are all "no filter": the API resolves each to
 * the same default, and a URL that says so explicitly (`?status=`) is noise
 * over the bare path.
 */
export function toQuery(
	filters: Record<string, string | number | undefined | null>,
): string {
	const params = new URLSearchParams();

	for (const [key, value] of Object.entries(filters)) {
		if (value !== undefined && value !== null && value !== "") {
			params.set(key, String(value));
		}
	}

	const query = params.toString();

	return query ? `?${query}` : "";
}

/** A POST/PATCH/DELETE with a JSON body; the mutations all share this shape. */
export function send<T>(
	path: string,
	method: string,
	body: unknown,
): Promise<T> {
	return requestJson<T>(path, {
		method,
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

/**
 * What a form submits, exactly as the form collected it.
 *
 * Every value is a string (that is what a form control produces) and the
 * server owns every coercion — the API's validators are the reference
 * variant's zod schemas, which accept the form's spelling verbatim.
 */
export type FormValues = Record<string, string>;

/**
 * The API's outcome envelope.
 *
 * `redirectTo` is the route the reference variant navigates to after the same
 * mutation; `message` is the user-visible success string. A reply without a
 * `redirectTo` (adding a comment) means: stay on this page and refresh.
 */
export type MutationResult = {
	ok: true;
	message?: string;
	redirectTo?: string;
};
