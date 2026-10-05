// The output schemas, shared across the domain contracts.
//
// These exist as Zod schemas rather than being inferred from the TypeScript types
// in src/lib/types.ts, because oRPC validates every reply against its contract's
// `.output()` at runtime. `User` and friends are compile-time shapes; these are
// the runtime assertion that the SQL in src/lib/data.ts still produces them.
//
// A schema drifting from its type is the failure mode worth guarding: the app
// keeps compiling, the type says `number`, the database starts returning a
// string, and the breakage surfaces in the UI as a rendered blank or a thrown
// error far from the query that caused it.
//
// Convention, kept from the SQL projections in src/lib/data.ts:
//
//   * ids and counts are `.int()`, because Postgres casts them with `::int`.
//   * every timestamp is a STRING. lib/data.ts stringifies them so plain JSON
//     round-trips; a `z.date()` here would reject every row.
//   * `assigneeId` is `.nullable()`, not `.optional()`: a task may genuinely be
//     unassigned, and the difference is load-bearing in the edit form's select.

import { z } from "zod";

/** Mirrors `TaskStatus`. A bare string would let a typo reach the status badge. */
export const TaskStatusSchema = z.enum(["todo", "in progress", "done"]);

/** Mirrors `Project`. */
export const ProjectSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  description: z.string(),
  taskCount: z.number().int(),
  openTaskCount: z.number().int(),
  peopleCount: z.number().int(),
  createdAt: z.string(),
});

/** Mirrors `DashboardProject`: a Project without its creation date. */
export const DashboardProjectSchema = ProjectSchema.omit({ createdAt: true });

/** Mirrors `User`. */
export const UserSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  email: z.string(),
  assignedTaskCount: z.number().int(),
  openTaskCount: z.number().int(),
  commentCount: z.number().int(),
});

/** Mirrors `Task`. */
export const TaskSchema = z.object({
  id: z.number().int(),
  projectId: z.number().int(),
  title: z.string(),
  description: z.string(),
  status: TaskStatusSchema,
  assigneeId: z.number().int().nullable(),
  assigneeName: z.string(),
  commentCount: z.number().int(),
  updatedAt: z.string(),
});

/** Mirrors `TaskWithProject`: a task joined with its project's name. */
export const TaskWithProjectSchema = TaskSchema.extend({
  projectName: z.string(),
});

/**
 * Mirrors `ProjectTaskRow` — a row from the project task board.
 *
 * `createdAtRaw` is the microsecond-precision timestamp the keyset cursor packs,
 * and the board is ordered by `created_at`.
 */
export const ProjectTaskRowSchema = TaskWithProjectSchema.extend({
  /** Opaque `(timestamp, id)` keyset; the next page starts after it. */
  cursorFor: z.string(),
  createdAtRaw: z.string(),
});

/**
 * Mirrors `TaskRow` — a row from the workspace-wide list.
 *
 * Deliberately NOT merged with {@link ProjectTaskRowSchema}: the two carry
 * different raw timestamps (`created_at` for the board, `updated_at` for the
 * list) and a merged schema with both optional would stop asserting either. The
 * shared `cursorFor` is the only common part, and it is what the pages consume.
 */
export const TaskRowSchema = TaskWithProjectSchema.extend({
  /** Opaque `(timestamp, id)` keyset; the next page starts after it. */
  cursorFor: z.string(),
  updatedAtRaw: z.string(),
});

/**
 * Mirrors `DashboardTask` in src/lib/types.ts, which lists exactly the columns
 * `getRecentTasks` selects: id, title, projectName, status, assigneeName and
 * updatedAt.
 *
 * This was previously derived as
 * `TaskWithProjectSchema.omit({ projectId, description, commentCount })`, which
 * kept `assigneeId` — a column the query has never selected. `next build` caught
 * it: prerendering "/" failed with "Output validation failed" because the row
 * genuinely has no `assigneeId`. The type has been narrowed alongside this
 * schema so the two agree.
 */
export const DashboardTaskSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  projectName: z.string(),
  status: TaskStatusSchema,
  assigneeName: z.string(),
  updatedAt: z.string(),
});

/** Mirrors `Comment`. */
export const CommentSchema = z.object({
  id: z.number().int(),
  taskId: z.number().int(),
  authorName: z.string(),
  body: z.string(),
  createdAt: z.string(),
});

/** Mirrors `DashboardStats`. */
export const DashboardStatsSchema = z.object({
  projectCount: z.number().int(),
  totalTasks: z.number().int(),
  openTasks: z.number().int(),
  peopleCount: z.number().int(),
  todoTasks: z.number().int(),
  inProgressTasks: z.number().int(),
  doneTasks: z.number().int(),
});

/**
 * Mirrors `FieldErrors` in src/lib/result.ts, which is
 * `Record<string, string[] | undefined>` — the shape `zod`'s
 * `.flatten().fieldErrors` produces.
 *
 * The `.optional()` on the value is load-bearing, not defensive. zod's flattened
 * fieldErrors include keys whose value is `undefined`, so a stricter schema
 * (`Record<string, string[]>`) rejects every write's output at runtime and fails
 * to compile against `ActionResult`.
 */
export const FieldErrorsSchema = z.record(
  z.string(),
  z.array(z.string()).optional(),
);

/**
 * Mirrors `ActionResult` in src/lib/result.ts.
 *
 * This is the write contract, and it is deliberately a VALUE rather than an
 * oRPC error. A blank name, a deleted assignee or a foreign key that blocks a
 * delete is ordinary user error the form already renders; see the long comment
 * in src/lib/result.ts for the full argument. Declaring `.errors()` on the
 * contract instead would push the same `{ fieldName: string[] }` through the
 * error channel and force the form to re-derive it.
 */
export const ActionResultSchema = z.union([
  z.object({ ok: z.literal(true), id: z.number().int() }),
  z.object({
    ok: z.literal(false),
    errors: FieldErrorsSchema.optional(),
    message: z.string().optional(),
  }),
]);
