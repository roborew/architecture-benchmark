// The write contract: what a mutation returns when it is refused.
//
// A Server Action signalled "validation failed" by resolving to `{ errors }`, and
// tRPC's instinct is to throw a TRPCError for any failure. Both instincts are
// wrong here: an empty name, a deleted assignee or a foreign key that blocks a
// delete is ordinary user error, not an exceptional condition. The UI already
// renders a field-level message and an `aria-invalid` attribute for it.
//
// So writes return a discriminated union and the client narrows with
// `if (!result.ok)`, rather than abusing the error channel and re-deriving field
// paths on the client. Consequence: the error markup in the forms keeps working
// unchanged, because `errors` is still `{ fieldName: string[] }`.
//
// This lives in lib/ rather than trpc/ because it is the contract of the data
// layer, not of the transport: src/lib/data.ts produces these values, the routers
// pass them through unchanged, and the components render them. Nothing here
// mentions tRPC.

/** Matches the shape of `zod`'s `.flatten().fieldErrors`. */
export type FieldErrors = Record<string, string[] | undefined>;

/** The write committed. `id` is the row that was written. */
export type ActionOk = { ok: true; id: number };

/**
 * The write was refused and changed nothing.
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

/**
 * Turns a `zod` failure into the `errors` half of a refusal.
 *
 * Every write validates inside its data-layer function rather than at the router's
 * `.input()`, because a `.input()` rejection surfaces as a TRPCError whose
 * `zodError` payload the form would have to re-parse to recover the same
 * `{ fieldName: string[] }` the UI already renders. Validating in the data layer
 * keeps the error contract identical for every caller, and costs one extra
 * safeParse on a path that is already doing a database round-trip.
 */
export function fieldErrors(error: {
  flatten(): { fieldErrors: FieldErrors };
}): FieldErrors {
  return error.flatten().fieldErrors;
}
