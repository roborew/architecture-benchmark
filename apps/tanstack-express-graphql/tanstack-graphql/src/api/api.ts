// src/api/api.ts
//
// How the SPA talks to the server — the shared half of the api layer.
//
// Every operation goes through `request`, so the endpoint, the error
// envelope, and the response handling are decided in exactly one place. The
// per-feature modules (projects, tasks, users, comments, dashboard) build on
// this piece and own their documents; nothing outside `src/api/` talks to the
// GraphQL endpoint directly.
//
// The transport is `graphql-request` (the client the TanStack Query GraphQL
// guide builds on): one GraphQLClient for the app, pointed at the API's
// /graphql route. A document's variables travel exactly as the caller built
// them — reads pass their filter objects (absent filters are undefined, which
// JSON drops, the same as the REST layer's omit-empties rule), mutations pass
// the form's field bag through untouched: the server owns every
// normalisation rule (an empty assignee means "unassigned", a numeric string
// is a row id), so the client cannot disagree with itself about how a value
// is spelled.
//
// GraphQL answers every request with HTTP 200 and carries outcomes in
// `errors`; the API throws GraphQLErrors whose `extensions` carry the parts
// of the REST envelope (`code` — the status line — and `errors`, the field →
// messages map). `toApiError` reverses that mapping, so everything above this
// layer still sees the `ApiError` it was built against: routes branch on
// `status === 404` for their not-found states, and forms render
// `errors.title` from the same field keys the REST API used.

import { ClientError, GraphQLClient } from "graphql-request";

/**
 * The platform's fetch, resolved at call time rather than import time.
 *
 * graphql-request defaults to cross-fetch, which captures the platform fetch
 * when its module is imported — too early for an environment whose fetch can
 * still change (a test stubbing it, a polyfill installed later). Resolving
 * through the ambient fetch here keeps the client honest about which fetch
 * is in effect when the request runs.
 */
const ambientFetch: typeof fetch = (input, init) => fetch(input, init);

/** Where the Express API lives. Overridable per environment (e2e points it at its own server). */
export const API_URL: string =
	import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/** One client for the app: the API's GraphQL route, and nothing else. */
const client = new GraphQLClient(`${API_URL}/graphql`, { fetch: ambientFetch });

/** The codes the API's deliberate errors carry, and the status each stands for. */
const STATUS_BY_CODE: Record<string, number> = {
	BAD_INPUT: 400,
	NOT_FOUND: 404,
	CONFLICT: 409,
};

/**
 * A failure the API reported deliberately.
 *
 * `message` is the user-visible string from the error the API threw (the REST
 * envelope's `{ error }` line, verbatim); `errors` is the field → messages map
 * a validation failure carries, keyed exactly as the API's validators key it.
 * A network-level failure (fetch itself rejecting) is not an ApiError — there
 * is no status to report, only the browser's generic message.
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

/** The first GraphQL error a response carries, with the extensions typed. */
function firstError(error: ClientError): {
	message?: string;
	code?: unknown;
	errors?: unknown;
} {
	const first = error.response.errors?.[0];

	if (!first) {
		return {};
	}

	return {
		message: first.message,
		code: first.extensions?.code,
		errors: first.extensions?.errors,
	};
}

/** A GraphQL response's error back into the ApiError shape the app is built on. */
function toApiError(error: ClientError): ApiError {
	// The extensions are the only guaranteed facts; a proxy or a crash can
	// hand back an errors array without them, so each falls back the same way
	// the REST envelope's parser did.
	const first = firstError(error);
	const code = typeof first.code === "string" ? first.code : undefined;
	const status = (code !== undefined && STATUS_BY_CODE[code]) || 400;
	const errors =
		first.errors && typeof first.errors === "object"
			? (first.errors as Record<string, string[]>)
			: {};

	return new ApiError(status, first.message ?? "Request failed", errors);
}

/**
 * Runs one operation and unwraps the field the caller asked for.
 *
 * Resolves with the response's `data`; rejects with an `ApiError` when the API
 * answered deliberately (its errors carry the codes and field maps above) and
 * rethrows anything else — a network failure the user still needs to see, not
 * an unhandled rejection inside a transition.
 */
export async function request<TData>(
	query: string,
	variables?: Record<string, unknown>,
): Promise<TData> {
	try {
		return await client.request<TData>(query, variables);
	} catch (error) {
		if (error instanceof ClientError) {
			throw toApiError(error);
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
