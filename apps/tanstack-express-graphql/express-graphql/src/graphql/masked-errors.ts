// src/graphql/masked-errors.ts
//
// Yoga's masking decides whether an error is *deliberate* — a GraphQLError the
// app meant to answer with — or *unexpected* — a bug or a database failure —
// and forwards only the former. Its decision is `error instanceof GraphQLError`,
// compared against the copy of the `graphql` package Yoga itself loaded.
//
// That works under plain Node, where the app and Yoga resolve `graphql` to one
// module instance. Under vitest's module runner they resolve to two: the
// resolvers run against a `graphql` copy the runner provides, while the
// externalized Yoga keeps its own. `instanceof` then fails for the errors our
// own factories built, and every deliberate NOT_FOUND / BAD_INPUT / CONFLICT
// outcome comes back masked as "Internal server error" — a test-only failure
// that would hide the whole error contract.
//
// Pinning the masking decision to module identity makes it hostage to however
// the app happens to be loaded. This module instead pays attention to what the
// errors ARE: a deliberate error is a GraphQLError whose `originalError` chain
// bottoms out at another GraphQLError, and an unexpected error is anything whose
// chain reaches a plain Error. That is the same rule Yoga applies — merely
// without the cross-instance `instanceof`, which is what makes it hold under any
// loader. `err.name === "GraphQLError"` is the duck-type `@envelop/core` (the
// layer Yoga delegates its masking to) already relies on for exactly this
// reason.

import { GraphQLError } from "graphql";

/**
 * Whether a value is (or a subclass of) a GraphQLError, judged by its shape
 * rather than its module identity — so copies of the `graphql` package count.
 */
function isGraphQLErrorLike(value: unknown): value is GraphQLError {
  return value instanceof Error && value.name === "GraphQLError";
}

/**
 * Whether an error is one the app answered with on purpose.
 *
 * Deliberate errors are GraphQLErrors all the way down their `originalError`
 * chain; the chain ends at the GraphQLError a resolver (or GraphQL's own
 * argument coercion) constructed. An unexpected error — a raw driver or
 * runtime Error — leaves a non-GraphQLError at the bottom and is reported as
 * false, so it gets masked.
 */
export function isDeliberateError(error: unknown): error is GraphQLError {
  if (!isGraphQLErrorLike(error)) {
    return false;
  }
  return error.originalError == null || isDeliberateError(error.originalError);
}

/**
 * Yoga's `maskError` replacement: return a deliberate error untouched — its
 * message and `extensions` ARE the API contract — and replace anything else
 * with the same generic line the REST variant's error handler answered 500s
 * with, so a stack frame or SQL fragment never reaches the client.
 *
 * Used for `createYoga({ maskedErrors: { errorMessage, maskError } })`.
 */
export function maskError(error: unknown, message: string): Error {
  if (isDeliberateError(error)) {
    return error;
  }

  // An unexpected error still carries useful location metadata (the field and
  // coordinates in the document) — keep it, exactly as Yoga's default masker
  // does, so the generic message points at where the failure happened.
  if (isGraphQLErrorLike(error)) {
    return new GraphQLError(message, {
      nodes: error.nodes,
      source: error.source,
      positions: error.positions,
      path: error.path,
      originalError: error,
      extensions: { code: "INTERNAL_SERVER_ERROR", unexpected: true },
    });
  }

  return new GraphQLError(message, {
    originalError: error instanceof Error ? error : undefined,
    extensions: { code: "INTERNAL_SERVER_ERROR", unexpected: true },
  });
}
