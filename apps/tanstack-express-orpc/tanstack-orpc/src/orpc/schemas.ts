// src/orpc/schemas.ts
//
// The output schemas, shared across the domain contracts.
//
// A MIRROR of the API's own schemas (../../express-orpc/src/orpc/schemas.ts).
// The SPA is a standalone package (this repo has no shared workspace), so the
// contract travels as a mirrored pair rather than a shared import — the same
// convention the REST variant used for its row types (src/lib/types.ts mirrors
// the API's rows). The two files must move together: a schema changed on one
// side changes what the other validates against, and a drift is a compile
// error here the moment the API's reply stops matching.
//
// These exist as zod schemas rather than being inferred from the model types
// in src/<domain>/<domain>.model.ts, because oRPC validates every reply against
// its contract's `.output()` at runtime. `User` and friends are compile-time
// shapes; these are the runtime assertion that the SQL in the models still
// produces them. A schema drifting from its type is the failure mode worth
// guarding: the app keeps compiling, the type says `number`, the database
// starts returning a string, and the breakage surfaces in the UI far from the
// query that caused it.
//
// Convention, kept from the SQL projections in the models:
//
//   * ids and counts are `.int()`, because Postgres casts them with `::int`.
//   * every timestamp is a STRING (to_char / ::text), so plain JSON
//     round-trips; `createdAt` on a project is date-only.
//   * `status` is a plain string, mirroring the models' `status: string`
//     projection — the database's CHECK constraint is what bounds it.

import { z } from "zod";

/** The stored status values (spec/contract.md) — the database CHECK bounds them. */
export const TaskStatusSchema = z.enum(["todo", "in progress", "done"]);

/** Mirrors `User`. */
export const UserSchema = z.object({
	id: z.number().int(),
	name: z.string(),
	email: z.string(),
	assignedTaskCount: z.number().int(),
	openTaskCount: z.number().int(),
	commentCount: z.number().int(),
});

/** Mirrors `Task` — a task joined with its project and assignee names. */
export const TaskSchema = z.object({
	id: z.number().int(),
	projectId: z.number().int(),
	projectName: z.string(),
	title: z.string(),
	description: z.string(),
	status: TaskStatusSchema,
	assigneeName: z.string(),
	commentCount: z.number().int(),
	updatedAt: z.string(),
});

/**
 * Mirrors `TaskRow` — a row from the workspace-wide list.
 *
 * `updatedAtRaw` is the microsecond-precision timestamp the keyset cursor packs,
 * and the list is ordered by `updated_at`.
 */
export const TaskRowSchema = TaskSchema.extend({
	/** Opaque `(updated_at, id)` keyset; the next page starts after it. */
	cursorFor: z.string(),
	updatedAtRaw: z.string(),
});

/**
 * Mirrors `ProjectTaskRow` — a row from a project's task board.
 *
 * Deliberately NOT merged with {@link TaskRowSchema}: the two carry different
 * raw timestamps (`updated_at` for the list, `created_at` for the board) and a
 * merged schema with both optional would stop asserting either.
 */
export const ProjectTaskRowSchema = TaskSchema.extend({
	/** Opaque `(created_at, id)` keyset; the next page starts after it. */
	cursorFor: z.string(),
	createdAtRaw: z.string(),
});

/** Mirrors `Comment`. */
export const CommentSchema = z.object({
	id: z.number().int(),
	taskId: z.number().int(),
	authorName: z.string(),
	body: z.string(),
	createdAt: z.string(),
});

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

/** Mirrors `DashboardTask` — the recent-tasks table's slimmer row. */
export const DashboardTaskSchema = z.object({
	id: z.number().int(),
	title: z.string(),
	projectName: z.string(),
	status: TaskStatusSchema,
	assigneeName: z.string(),
	updatedAt: z.string(),
});

/** Mirrors `DashboardProject` — the dashboard card, without the creation date. */
export const DashboardProjectSchema = z.object({
	id: z.number().int(),
	name: z.string(),
	description: z.string(),
	taskCount: z.number().int(),
	openTaskCount: z.number().int(),
	peopleCount: z.number().int(),
});

/** Mirrors `DashboardData` — the dashboard aggregate, one reply for the page. */
export const DashboardDataSchema = z.object({
	stats: DashboardStatsSchema,
	recentTasks: z.array(DashboardTaskSchema),
	projects: z.array(DashboardProjectSchema),
});

/**
 * Mirrors `FieldErrors` — the field → messages map the validators produce
 * (zod's `.flatten().fieldErrors` shape).
 *
 * The `.optional()` on the value is load-bearing, not defensive: a validator's
 * flattened fieldErrors include keys whose value is `undefined`, so a stricter
 * schema (`Record<string, string[]>`) would reject every failed write.
 */
export const FieldErrorsSchema = z.record(
	z.string(),
	z.array(z.string()).optional(),
);

/**
 * Mirrors `MutationResult` — the SPA's outcome envelope.
 *
 * `redirectTo` is the route the SPA navigates to after the same mutation;
 * `message` is the user-visible success string. A reply without a
 * `redirectTo` (adding a comment) means: stay on this page and refresh.
 */
export const MutationResultSchema = z.object({
	ok: z.literal(true),
	message: z.string().optional(),
	redirectTo: z.string().optional(),
});
