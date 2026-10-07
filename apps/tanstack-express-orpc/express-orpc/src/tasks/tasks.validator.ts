// src/tasks/tasks.validator.ts
//
// Input validation for the tasks surface, kept pure so it can be unit tested
// without a transport: the status filter value rules, and the bodies of every
// write. The router maps an error case onto the error envelope; the model
// never sees an invalid value.
//
// The zod rules and their message strings are ported verbatim from the
// reference variant's actions.ts (TaskSchema / CommentSchema), so a client that
// rendered the reference app's validation errors renders ours unchanged. A
// body's absent field is normalised to null before parsing: the reference
// parses FormData, where a field the form did not submit reads back as null,
// and zod's own messages ("received null") are part of that contract.
//
// The query-string parsing this file used to carry (parseTaskListQuery /
// parseProjectTaskListQuery and the integer/single-value param helpers) is
// gone: under REST those values rode in a URL as strings, so something had to
// parse them; under oRPC the contract's `.input()` types them, so the shape
// check moved into the contract. What stays are the VALUE rules whose messages
// the reference owns (an unknown status) and the write-side body schemas.

import { z } from "zod";

/** The stored status values (spec/contract.md) — identical to the reference's. */
export const TASK_STATUSES = ["todo", "in progress", "done"] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

/** The outcome of parsing a body: the shape, or the field → messages map. */
export type Parsed<T> =
  { ok: true; data: T } | { ok: false; errors: Record<string, string[]> };

/** Reads a request body as a field bag; a non-object body has no fields. */
function asBody(raw: unknown): Record<string, unknown> {
  return (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Read-side query params
// ---------------------------------------------------------------------------

export type ParsedTaskStatus =
  | { readonly ok: true; readonly status: string }
  | { readonly ok: false; readonly error: string };

/**
 * Parses the `status` filter.
 *
 * `status` is constrained text in the schema, so the reference's query layer
 * validates it against the stored values and throws `Unknown task status: …`;
 * the same message is this API's 400 envelope. Absent, empty and whitespace
 * values mean "every status". A repeated param arrives as an array and is
 * rejected, like `q`.
 */
export function parseTaskStatus(raw: unknown): ParsedTaskStatus {
  if (raw === undefined) {
    return { ok: true, status: "" };
  }

  if (typeof raw !== "string") {
    return { ok: false, error: "status must be a single value" };
  }

  const term = raw.trim();

  if (term && !TASK_STATUSES.includes(term as TaskStatus)) {
    return { ok: false, error: `Unknown task status: ${term}` };
  }

  return { ok: true, status: term };
}

/** A single-value string param; absent is fine, an array is a client bug. */
export type TaskListFilters = {
  search: string;
  status: string;
  projectId?: number;
  assigneeId?: number;
  cursor: string | null;
  /** Raw limit; the model clamps it to [1, 26] as the reference does. */
  limit?: number;
};

export type ProjectTaskFilters = {
  status: string;
  cursor: string | null;
  limit?: number;
};

// ---------------------------------------------------------------------------
// Write-side bodies (zod rules ported verbatim from the reference's actions.ts)
// ---------------------------------------------------------------------------

const TaskFieldsSchema = z.object({
  title: z
    .string()
    .trim()
    // Matches the CHECK (char_length BETWEEN 1 AND 200) in spec/schema.sql, so
    // the same bound is enforced in the form and the database.
    .min(1, "Title is required.")
    .max(200, "Title must be 200 characters or fewer."),
  // An omitted description is legal (the column defaults to ''), so null —
  // which is what a field the client did not send reads back as — is
  // normalised here rather than reported as a validation failure.
  description: z.preprocess(
    (value) => (value === null || value === undefined ? "" : value),
    z.string().trim(),
  ),
  status: z.enum(TASK_STATUSES, {
    message: "Choose a valid status.",
  }),
});

export type TaskFields = {
  title: string;
  description: string;
  status: TaskStatus;
};

/** The task fields a create or update body submits (title/description/status). */
export function parseTaskFields(raw: unknown): Parsed<TaskFields> {
  const body = asBody(raw);
  const parsed = TaskFieldsSchema.safeParse({
    title: body.title ?? null,
    description: body.description ?? null,
    status: body.status ?? null,
  });

  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors };
  }

  return { ok: true, data: parsed.data };
}

export type ParsedTaskRefs =
  | { ok: true; projectId: number; assigneeId: number | null }
  | { ok: false; errors: Record<string, string[]> };

/**
 * The pure half of the reference's `resolveRefs`: which ids could name a row.
 *
 * `assigneeId` is nullable, and spec/contract.md gives exactly one way to
 * unassign — an explicit empty choice — so absent, null and "" all mean
 * "unassigned" rather than invalid. Everything else must be an integer; the
 * database half (does the row exist) is the model's, run only once the shape is
 * known to be good.
 */
export function parseCreateTaskRefs(raw: {
  projectId?: unknown;
  assigneeId?: unknown;
}): ParsedTaskRefs {
  const projectIdRaw = raw.projectId;
  const projectId =
    projectIdRaw === null || projectIdRaw === undefined
      ? NaN
      : Number(projectIdRaw);

  const assigneeRaw = raw.assigneeId;
  const assigneeId =
    assigneeRaw === null || assigneeRaw === undefined || assigneeRaw === ""
      ? null
      : Number(assigneeRaw);

  const errors: Record<string, string[]> = {};

  if (!Number.isInteger(projectId)) {
    errors.projectId = ["Choose a project."];
  }

  if (assigneeId !== null && !Number.isInteger(assigneeId)) {
    errors.assigneeId = ["Choose a valid assignee."];
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, projectId, assigneeId };
}

export type ParsedAssigneeRef =
  | { ok: true; assigneeId: number | null }
  | { ok: false; errors: Record<string, string[]> };

/** The update body's assignee: the same rule as `parseCreateTaskRefs`, alone. */
export function parseUpdateAssignee(raw: {
  assigneeId?: unknown;
}): ParsedAssigneeRef {
  const assigneeRaw = raw.assigneeId;
  const assigneeId =
    assigneeRaw === null || assigneeRaw === undefined || assigneeRaw === ""
      ? null
      : Number(assigneeRaw);

  if (assigneeId !== null && !Number.isInteger(assigneeId)) {
    return { ok: false, errors: { assigneeId: ["Choose a valid assignee."] } };
  }

  return { ok: true, assigneeId };
}

// The comment half of a create-with-comment body, keyed as the reference's
// CommentSchema keys it. The 1000-character bound matches the CHECK on
// comments.body in spec/schema.sql. The author is coerced because it arrives
// from a <select> as a string.
const WithCommentFieldsSchema = z.object({
  commentBody: z.preprocess(
    (value) => (value === null || value === undefined ? "" : value),
    z
      .string()
      .trim()
      .min(1, "Comment is required.")
      .max(1000, "Comment must be 1000 characters or fewer."),
  ),
  commentAuthorId: z.coerce.number().int().positive(),
});

export type WithCommentFields = {
  commentBody: string;
  commentAuthorId: number;
};

/** The comment fields of a create-with-comment body (commentBody/commentAuthorId). */
export function parseWithCommentFields(
  raw: unknown,
): Parsed<WithCommentFields> {
  const body = asBody(raw);
  const parsed = WithCommentFieldsSchema.safeParse({
    commentBody: body.commentBody ?? null,
    commentAuthorId: body.commentAuthorId ?? null,
  });

  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors };
  }

  return { ok: true, data: parsed.data };
}

// A comment submitted on an existing task. The same rules as the with-comment
// half, keyed by this endpoint's own body field names (body/authorId) so an
// error lands on the field the client actually sent.
const CommentBodySchema = z.object({
  body: z.preprocess(
    (value) => (value === null || value === undefined ? "" : value),
    z
      .string()
      .trim()
      .min(1, "Comment is required.")
      .max(1000, "Comment must be 1000 characters or fewer."),
  ),
  authorId: z.coerce.number().int().positive(),
});

export type CommentBodyFields = {
  body: string;
  authorId: number;
};

/** The POST /api/tasks/:id/comments body (body/authorId). */
export function parseCommentBody(raw: unknown): Parsed<CommentBodyFields> {
  const body = asBody(raw);
  const parsed = CommentBodySchema.safeParse({
    body: body.body ?? null,
    authorId: body.authorId ?? null,
  });

  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors };
  }

  return { ok: true, data: parsed.data };
}
