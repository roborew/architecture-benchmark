// src/projects/projects.validator.ts
//
// Input validation for the projects surface, kept pure so it can be unit
// tested without Express: the `q` search param (shared lib validator) and the
// JSON body of create/update. The zod rules and their message strings are
// ported verbatim from the reference variant's ProjectSchema
// (apps/tanstack-start-react/src/lib/actions.ts), so a client that rendered
// the reference app's validation errors renders ours unchanged.
//
// Note the asymmetry with tasks: the reference's ProjectSchema does NOT
// preprocess `description`, so a body that omits it is a validation failure
// ("Invalid input: expected string, received null") exactly as it is there.

import { z } from "zod";

/** The outcome of parsing a body: the shape, or the field → messages map. */
export type Parsed<T> =
  | { ok: true; data: T }
  | { ok: false; errors: Record<string, string[]> };

const ProjectBodySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Project name is required.")
    // The schema puts no limit on projects.name, but tasks.title caps at 200.
    .max(200, "Project name must be 200 characters or fewer."),
  description: z.string().trim(),
});

export type ProjectBodyFields = {
  name: string;
  description: string;
};

/**
 * Parses a create/update project body (`{ name, description }`).
 *
 * An absent field reads back as null — the same value the reference's
 * formData.get returns for a field the form did not submit — so zod's own
 * messages match the reference's one-for-one.
 */
export function parseProjectBody(raw: unknown): Parsed<ProjectBodyFields> {
  const body =
    (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const parsed = ProjectBodySchema.safeParse({
    name: body.name ?? null,
    description: body.description ?? null,
  });

  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors };
  }

  return { ok: true, data: parsed.data };
}
