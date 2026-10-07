// src/users/users.validator.ts
//
// Input validation for the users surface, kept pure so it can be unit tested
// without Express: the JSON body of create/update. The zod rules and their
// message strings are ported verbatim from the reference variant's UserSchema
// (apps/tanstack-start-react/src/lib/actions.ts), so a client that rendered
// the reference app's validation errors renders ours unchanged.

import { z } from "zod";

/** The outcome of parsing a body: the shape, or the field → messages map. */
export type Parsed<T> =
  | { ok: true; data: T }
  | { ok: false; errors: Record<string, string[]> };

/**
 * `users.email` has no UNIQUE constraint (spec/schema.sql) and
 * spec/contract.md requires none, so no uniqueness rule is imposed here — two
 * members may legitimately share an address. The address is still shape-checked
 * because the form declares `type="email"` and the server should agree.
 */
const UserBodySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "User name is required.")
    .max(200, "User name must be 200 characters or fewer."),
  email: z
    .string()
    .trim()
    .min(1, "Email is required.")
    .email("Enter a valid email address."),
});

export type UserBodyFields = {
  name: string;
  email: string;
};

/**
 * Parses a create/update user body (`{ name, email }`).
 *
 * An absent field reads back as null — the same value the reference's
 * formData.get returns for a field the form did not submit — so zod's own
 * messages match the reference's one-for-one.
 */
export function parseUserBody(raw: unknown): Parsed<UserBodyFields> {
  const body =
    (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const parsed = UserBodySchema.safeParse({
    name: body.name ?? null,
    email: body.email ?? null,
  });

  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors };
  }

  return { ok: true, data: parsed.data };
}
