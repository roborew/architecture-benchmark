// src/graphql/graphql-error.ts
//
// The typed error a resolver throws for every outcome the API answers with
// something other than a success — the GraphQL replacement for the REST
// variant's `HttpError` + error-handler middleware pair.
//
// GraphQL has no HTTP status codes: Yoga catches whatever a resolver throws
// and answers with the same HTTP 200 and the error inside `errors`. What the
// REST envelope carried in `{ error, errors? }` and the status line therefore
// travels in the GraphQLError's `message` and `extensions` instead, exactly
// one place per outcome kind:
//
//   validation   message: "Missing fields. …"        extensions.errors: {field: [msgs]}
//   not-found     message: "That task no longer…"     extensions.code: NOT_FOUND
//   conflict      message: "This person still has…"  extensions.code: CONFLICT
//   bad-input     message: "Unknown task status: …"   extensions.code: BAD_INPUT
//
// The SPA's api client reverses this mapping (src/api/api.ts of the
// tanstack-graphql app): extensions.code becomes the `ApiError.status` its
// routes branch on (404 → the inline not-found state, 409 → the guard
// message), and `extensions.errors` becomes the field → messages map its
// forms render — so the message strings and field keys stay the contract,
// exactly as they were over REST.

import { GraphQLError } from "graphql";

/** 400-equivalent: a validation failure, carrying the field → messages map. */
export function validationError(
  message: string,
  errors: Record<string, string[]>,
): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "BAD_INPUT", errors },
  });
}

/** 404-equivalent: a row the request names that no longer (or never) exists. */
export function notFoundError(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "NOT_FOUND" } });
}

/** 409-equivalent: an FK guard refusal with the reference's actionable message. */
export function conflictError(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "CONFLICT" } });
}

/** 400-equivalent: a malformed argument the shared validators rejected. */
export function badInputError(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "BAD_INPUT" } });
}
