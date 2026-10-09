// src/graphql/args.ts
//
// Small adapters from GraphQL-typed arguments to the shared, pure validators
// (src/lib/query.validator.ts, src/<domain>/<domain>.validator.ts).
//
// The validators were written for the REST surface, where every value arrived
// as a query-param string, and their rules — "id must be a positive integer",
// "projectId must be an integer", the exact message strings — are part of the
// contract. Rather than re-deriving those rules with GraphQL-native types (and
// drifting from the reference's messages), the resolvers hand the validators
// exactly what they were written for: string bags, built here from the typed
// arguments GraphQL already validated.

import { badInputError } from "./graphql-error.ts";
import { parseIdParam } from "../lib/query.validator.ts";

/**
 * An `Int!` argument naming a row, validated exactly as the REST `:id` param
 * was — a non-positive integer cannot name a primary key, and the message is
 * the shared validator's.
 */
export function requireIdArg(value: number): number {
  const parsed = parseIdParam(String(value));

  if (!parsed.ok) {
    throw badInputError(parsed.error);
  }

  return parsed.id;
}

/** A nullable Int filter argument as the string the validators expect. */
export function intArg(value: number | null | undefined): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

/** A nullable String filter argument; null means "absent", the same as REST. */
export function stringArg(
  value: string | null | undefined,
): string | undefined {
  return value === null || value === undefined ? undefined : value;
}
