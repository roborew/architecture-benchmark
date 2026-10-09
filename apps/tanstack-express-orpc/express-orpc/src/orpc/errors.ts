// src/orpc/errors.ts
//
// The typed error a router throws for every outcome the API answers with
// something other than a success: the oRPC error code plus the exact payload
// the client should receive.
//
// Routers return successes and throw `ORPCError` for every refusal; the RPC
// handler maps the throw onto a JSON error reply (oRPC's code → status mapping:
// BAD_REQUEST 400, NOT_FOUND 404, CONFLICT 409), and the SPA's api layer
// re-derives its `ApiError` from the same code/message/data. That keeps the
// error envelope ({ error, errors? }) described in exactly one place — the
// router that decided the outcome — instead of being re-derived from an error
// message deep in the stack, and it lets the pure validators produce plain
// data that the router wraps, rather than validators knowing about transport.
//
// This replaces the REST variant's HttpError (src/lib/http-error.ts): same
// three factories, same payload shapes, now carried by oRPC's error channel
// instead of an Express error-handling middleware.

import { ORPCError } from "@orpc/server";

/**
 * The payload every refusal carries: the reference variant's JSON envelope.
 *
 * `error` is the human-readable line (doubles as the ORPCError message);
 * `errors` is the field → messages map a validation refusal produces, keyed
 * exactly as the validators key it.
 */
export type ErrorEnvelope = {
  error: string;
  errors?: Record<string, string[]>;
};

/** 400 with the field → messages envelope a validation failure produces. */
export function validationError(
  error: string,
  errors: Record<string, string[]> = {},
): ORPCError<"BAD_REQUEST", ErrorEnvelope> {
  return new ORPCError("BAD_REQUEST", {
    message: error,
    data: Object.keys(errors).length > 0 ? { error, errors } : { error },
  });
}

/** 404 with the API's plain `{ error }` envelope. */
export function notFoundError(
  error: string,
): ORPCError<"NOT_FOUND", ErrorEnvelope> {
  return new ORPCError("NOT_FOUND", { message: error, data: { error } });
}

/** 409 with the reference's FK guard message. */
export function conflictError(
  error: string,
): ORPCError<"CONFLICT", ErrorEnvelope> {
  return new ORPCError("CONFLICT", { message: error, data: { error } });
}
