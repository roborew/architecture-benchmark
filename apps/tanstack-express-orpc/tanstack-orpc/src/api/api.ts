// src/api/api.ts
//
// How the SPA talks to the server — the shared half of the api layer.
//
// Every write goes through `call` so the procedure wiring, the outcome
// envelope, and the error translation are decided in exactly one place. The
// per-feature modules (projects, tasks, users, comments) build on these
// pieces and own their procedures; nothing outside `src/api/` calls the oRPC
// client for a write, and nothing inside hand-builds a request any more —
// the reads are the query options' own procedures (src/queries/*, built from
// src/orpc/client.ts), and the writes below are thin, typed wrappers.
//
// Mutations send the form's fields as the field bag, passing them through
// untouched: the server owns every normalisation rule (an empty assignee
// means "unassigned", a numeric string is a row id), so the client cannot
// disagree with itself about how a value is spelled.

import { ORPCError } from "@orpc/client";

/**
 * A failure the API reported deliberately.
 *
 * `message` is the user-visible string from the API's error line; `errors` is
 * the field → messages map a validation refusal carries, keyed exactly as the
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

/** The HTTP status each oRPC error code maps onto, mirroring the API's envelope. */
const STATUS_BY_CODE: Record<string, number> = {
	BAD_REQUEST: 400,
	NOT_FOUND: 404,
	CONFLICT: 409,
};

/**
 * Runs one write, translating an ORPCError the API decided on into the
 * `ApiError` the forms render — the same status/message/field-errors shape
 * the REST envelope carried, which `useApiAction` and every form test were
 * written against. Anything else (fetch itself rejecting, a client bug)
 * propagates untouched: there is no envelope to derive, only the hook's
 * generic network-failure branch.
 */
export async function call<T>(write: () => Promise<T>): Promise<T> {
	try {
		return await write();
	} catch (error) {
		if (error instanceof ORPCError) {
			const data = error.data as
				| { errors?: Record<string, string[]> }
				| undefined;

			throw new ApiError(
				STATUS_BY_CODE[error.code] ?? 500,
				error.message,
				data?.errors ?? {},
			);
		}

		throw error;
	}
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
