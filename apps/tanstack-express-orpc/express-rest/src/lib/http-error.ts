// src/lib/http-error.ts
//
// The typed error a controller throws for every outcome the API answers with
// something other than a 2xx: the HTTP status plus the exact JSON payload the
// client should receive.
//
// Controllers write successes to the response and throw `HttpError` for every
// failure; `src/middleware/error-handler.ts` maps the throw onto
// `res.status(status).json(payload)`. That keeps the JSON error envelope
// ({ error, ... }) described in exactly one place — the controller that decided
// the outcome — instead of being re-derived from an error message deep in the
// stack, and it lets the pure validators produce plain data that the controller
// wraps, rather than validators knowing about HTTP.

export type JsonPayload = Record<string, unknown>;

export class HttpError extends Error {
  readonly status: number;
  readonly payload: JsonPayload;

  constructor(status: number, payload: JsonPayload) {
    // `payload.error` is the envelope's human-readable line, so it doubles as
    // the Error message a log or a test sees.
    super(typeof payload.error === "string" ? payload.error : `HTTP ${status}`);
    this.name = "HttpError";
    this.status = status;
    this.payload = payload;
  }

  /** 400 with the field → messages envelope a validation failure produces. */
  static validation(
    error: string,
    errors: Record<string, string[]>,
  ): HttpError {
    return new HttpError(400, { error, errors });
  }

  /** 404 with the API's plain `{ error }` envelope. */
  static notFound(error: string): HttpError {
    return new HttpError(404, { error });
  }

  /** 409 with the reference's FK guard message. */
  static conflict(error: string): HttpError {
    return new HttpError(409, { error });
  }
}
