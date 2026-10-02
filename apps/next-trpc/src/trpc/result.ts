// The tRPC replacement for the `State` type that Server Actions returned.
//
// A Server Action signals "validation failed" by resolving to `{ errors }`. tRPC
// has a different instinct: an unexpected failure is a `TRPCError`, and the client
// catches it. But expected validation failures are not exceptional — an empty name
// is ordinary user error, and the UI already renders a field-level message and an
// `aria-invalid` attribute for it. So mutations return a discriminated union and
// let the client narrow with `if (!result.ok)`, rather than abusing the error
// channel and re-deriving field paths on the client.
//
// Consequence: the existing error markup in the forms keeps working unchanged,
// because `errors` is still `{ fieldName: string[] }`.

/** Matches the shape of `zod`'s `.flatten().fieldErrors`. */
export type FieldErrors = Record<string, string[] | undefined>;

/** The mutation committed. `id` is the row that was written. */
export type ActionOk = { ok: true; id: number };

/**
 * The mutation was refused and changed nothing.
 *
 * `errors` is set when the cause is a specific field, `message` when it is not
 * (a stale id, a database fault, an FK restriction). Either may be absent, but
 * the caller must render something — these are user-visible per spec/contract.md.
 */
export type ActionErr = {
  ok: false;
  errors?: FieldErrors;
  message?: string;
};

export type ActionResult = ActionOk | ActionErr;
