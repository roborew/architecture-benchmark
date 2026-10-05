// The tasks domain: reads wrapped from src/lib/data.ts, writes migrated from the
// createTask/updateTask/deleteTask/createTaskWithComment Server Actions.
//
// Two things here are worth calling out because they are not obvious from the
// procedure list:
//
//   * `assigneeId` is `number | null` at the input boundary, not an optional
//     field. spec/contract.md gives exactly one way to unassign — an explicit
//     empty choice — so `null` means "unassigned" and `undefined` is not a
//     distinct state a caller can express.
//   * `createWithComment` keeps its transaction. The task insert alone would
//     succeed and leave a task whose opening comment was never written, a partial
//     state spec/queries.md says must never be observable.

import { z } from "zod";

import { sql } from "@/lib/db";
import {
  countTasks,
  getComments,
  getDashboardStats,
  getRecentTasks,
  getTask,
  getTasks,
} from "@/lib/data";
import { baseProcedure, createTRPCRouter } from "../init";
import type { ActionResult, FieldErrors } from "../result";

/**
 * The task fields a create or update submits.
 *
 * The title bound matches the CHECK (char_length BETWEEN 1 AND 200) in
 * spec/schema.sql, so the same limit is enforced in the form and the database.
 *
 * `projectId` is deliberately absent from the update input: spec/contract.md lists
 * the update form's fields as title, status, assignee and description only — a
 * task belongs to its project for its lifetime. Including it would let a caller
 * move a task to another project behind a form that never offers the choice.
 */
const TaskSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Title is required.")
    .max(200, "Title must be 200 characters or fewer."),
  // An omitted description is legal (the column defaults to ''), so it is
  // normalised to "" rather than reported as a validation failure.
  description: z.preprocess(
    (value) => (value === null || value === undefined ? "" : value),
    z.string().trim(),
  ),
  status: z.enum(["todo", "in progress", "done"], {
    message: "Choose a valid status.",
  }),
});

/**
 * A comment submitted on its own, or as the first comment of a new task.
 *
 * The 1000-character bound matches the CHECK on `comments.body` in
 * spec/schema.sql, so the form and the database enforce the same limit.
 */
const CommentSchema = z.object({
  commentBody: z
    .string()
    .trim()
    .min(1, "Comment is required.")
    .max(1000, "Comment must be 1000 characters or fewer."),
  commentAuthorId: z.number().int().positive(),
});

function fieldErrors(error: z.ZodError): FieldErrors {
  return error.flatten().fieldErrors;
}

/** True when the project id names a row. */
async function projectExists(projectId: number) {
  const [row] = await sql<{ id: number }[]>`
    SELECT id::int FROM projects WHERE id = ${projectId}
  `;

  return Boolean(row);
}

/** True when the member id names a row. An absent assignee is always fine. */
async function assigneeExists(assigneeId: number | null) {
  if (assigneeId === null) return true;

  const [row] = await sql<{ id: number }[]>`
    SELECT id::int FROM users WHERE id = ${assigneeId}
  `;

  return Boolean(row);
}

/** The stored `project_id` of a task, or `null` when no row matches. */
async function projectOfTask(taskId: number) {
  const [row] = await sql<{ project_id: number }[]>`
    SELECT project_id::int FROM tasks WHERE id = ${taskId}
  `;

  return row ?? null;
}

/**
 * The filters both `list` and `count` accept.
 *
 * Shared so the two cannot drift: the list page fetches a page and its total
 * separately, and a filter accepted by one but not the other would show a count
 * that disagrees with the rows beneath it.
 */
const TaskFilterInput = z.object({
  search: z.string().optional(),
  status: z.string().optional(),
  projectId: z.number().int().optional(),
  assigneeId: z.number().int().optional(),
});

export const tasksRouter = createTRPCRouter({
  list: baseProcedure
    .input(
      TaskFilterInput.extend({
        cursor: z.string().nullish(),
        limit: z.number().int().optional(),
      }),
    )
    .query(({ input }) =>
      getTasks({
        search: input.search,
        status: input.status,
        projectId: input.projectId,
        assigneeId: input.assigneeId,
        cursor: input.cursor ?? null,
        limit: input.limit,
      }),
    ),

  /**
   * The total matching the same filters `list` applies. A separate aggregate on
   * purpose: a window COUNT would force Postgres to materialise every matching row
   * before discarding all but the first page.
   */
  count: baseProcedure.input(TaskFilterInput).query(({ input }) =>
    countTasks({
      search: input.search,
      status: input.status,
      projectId: input.projectId,
      assigneeId: input.assigneeId,
    }),
  ),

  byId: baseProcedure
    .input(z.object({ id: z.number().int() }))
    .query(({ input }) => getTask(input.id)),

  /** The most recent comments on one task; spec/queries.md caps the page at 10. */
  comments: baseProcedure
    .input(
      z.object({ id: z.number().int(), limit: z.number().int().optional() }),
    )
    .query(({ input }) => getComments(input.id, input.limit)),

  /**
   * Workspace totals for the dashboard's stat cards.
   *
   * One statement rather than three, because the cards render together and
   * separate COUNT queries would each scan a different table for the same row.
   */
  dashboardStats: baseProcedure.query(() => getDashboardStats()),

  /**
   * The most recently updated tasks, for the dashboard's recent table.
   *
   * Ordered by `updated_at` rather than `created_at`: "recent activity" means when
   * the work last moved, which is also what `tasks.update` advances.
   */
  recent: baseProcedure
    .input(z.object({ limit: z.number().int().optional() }).optional())
    .query(({ input }) => getRecentTasks(input?.limit)),

  create: baseProcedure
    .input(
      z.object({
        title: z.string(),
        description: z.string().optional(),
        status: z.string(),
        projectId: z.number().int(),
        assigneeId: z.number().int().nullish(),
      }),
    )
    .mutation(async ({ input }): Promise<ActionResult> => {
      const parsed = TaskSchema.safeParse(input);

      if (!parsed.success) {
        return {
          ok: false,
          errors: fieldErrors(parsed.error),
          message: "Missing fields. Failed to create task.",
        };
      }

      const { title, description, status } = parsed.data;
      const assigneeId = input.assigneeId ?? null;

      // Only once the shape of the fields is known to be good does it make sense
      // to ask the database whether the referenced rows exist. Checking first
      // turns a dangling id into a field error rather than a thrown Postgres
      // error the user cannot act on.
      if (!(await projectExists(input.projectId))) {
        return {
          ok: false,
          errors: { projectId: ["That project no longer exists."] },
          message: "Missing fields. Failed to create task.",
        };
      }

      if (!(await assigneeExists(assigneeId))) {
        return {
          ok: false,
          errors: { assigneeId: ["That assignee no longer exists."] },
          message: "Missing fields. Failed to create task.",
        };
      }

      try {
        // created_at and updated_at are NOT NULL with no default, so the server
        // sets both explicitly and to the same instant.
        const [row] = await sql<{ id: number }[]>`
          INSERT INTO tasks (
            project_id, assignee_id, title, description, status, created_at, updated_at
          )
          VALUES (
            ${input.projectId}, ${assigneeId}, ${title}, ${description}, ${status}, now(), now()
          )
          RETURNING id::int AS id
        `;

        return { ok: true, id: row.id };
      } catch (error) {
        console.error("Database Error:", error);
        return { ok: false, message: "Database Error: Failed to create task." };
      }
    }),

  update: baseProcedure
    .input(
      z.object({
        id: z.number().int(),
        title: z.string(),
        description: z.string().optional(),
        status: z.string(),
        assigneeId: z.number().int().nullish(),
      }),
    )
    .mutation(async ({ input }): Promise<ActionResult> => {
      const { id } = input;
      const parsed = TaskSchema.safeParse(input);

      if (!parsed.success) {
        return {
          ok: false,
          errors: fieldErrors(parsed.error),
          message: "Missing fields. Failed to update task.",
        };
      }

      const { title, description, status } = parsed.data;
      const assigneeId = input.assigneeId ?? null;

      if (!(await assigneeExists(assigneeId))) {
        return {
          ok: false,
          errors: { assigneeId: ["That assignee no longer exists."] },
          message: "Missing fields. Failed to update task.",
        };
      }

      // Read the project first so the client knows which board to revalidate —
      // the task is leaving it or joining it.
      const existing = await projectOfTask(id);

      if (!existing) {
        return { ok: false, message: "That task no longer exists." };
      }

      try {
        // RETURNING distinguishes "no such row" from "row updated", so a stale
        // form cannot report success for a task that is already gone.
        const updated = await sql<{ id: number }[]>`
          UPDATE tasks
          SET
            title = ${title},
            description = ${description},
            status = ${status},
            assignee_id = ${assigneeId},
            updated_at = now()
          WHERE id = ${id}
          RETURNING id
        `;

        if (updated.length === 0) {
          return { ok: false, message: "That task no longer exists." };
        }
      } catch (error) {
        console.error("Database Error:", error);
        return { ok: false, message: "Database Error: Failed to update task." };
      }

      return { ok: true, id };
    }),

  delete: baseProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }): Promise<ActionResult> => {
      const { id } = input;

      // Read the project first: the client redirects to that board afterwards, and
      // the task's detail page is not-found once the row is gone.
      const existing = await projectOfTask(id);

      if (!existing) {
        return { ok: false, message: "That task no longer exists." };
      }

      try {
        // The task's comments go with it via `comments.task_id` ON DELETE CASCADE.
        const deleted = await sql<{ id: number }[]>`
          DELETE FROM tasks WHERE id = ${id} RETURNING id
        `;

        if (deleted.length === 0) {
          return { ok: false, message: "That task no longer exists." };
        }
      } catch (error) {
        console.error("Database Error:", error);
        return { ok: false, message: "Database Error: Failed to delete task." };
      }

      return { ok: true, id };
    }),

  /**
   * spec/queries.md — "Create with initial comment": one transaction inserting the
   * task then its comment, with any failure rolling back both.
   *
   * The transaction matters because the task insert alone would otherwise succeed
   * and leave a task whose first comment was never written.
   */
  createWithComment: baseProcedure
    .input(
      z.object({
        title: z.string(),
        description: z.string().optional(),
        status: z.string(),
        projectId: z.number().int(),
        assigneeId: z.number().int().nullish(),
        commentBody: z.string(),
        commentAuthorId: z.number().int(),
      }),
    )
    .mutation(async ({ input }): Promise<ActionResult> => {
      const parsed = TaskSchema.safeParse(input);

      if (!parsed.success) {
        return {
          ok: false,
          errors: fieldErrors(parsed.error),
          message: "Missing fields. Failed to create the task.",
        };
      }

      // The comment has its own bound (char_length BETWEEN 1 AND 1000), enforced by
      // its own schema so the message lands on the comment field.
      const comment = CommentSchema.safeParse({
        commentBody: input.commentBody,
        commentAuthorId: input.commentAuthorId,
      });

      if (!comment.success) {
        return {
          ok: false,
          errors: fieldErrors(comment.error),
          message: "Missing fields. Failed to create the task.",
        };
      }

      const { title, description, status } = parsed.data;
      const assigneeId = input.assigneeId ?? null;

      if (!(await projectExists(input.projectId))) {
        return {
          ok: false,
          errors: { projectId: ["That project no longer exists."] },
          message: "Missing fields. Failed to create the task.",
        };
      }

      if (!(await assigneeExists(assigneeId))) {
        return {
          ok: false,
          errors: { assigneeId: ["That assignee no longer exists."] },
          message: "Missing fields. Failed to create the task.",
        };
      }

      // The author is a FK like the assignee, so an id that matches no row fails
      // the insert. Checking first turns that into a field error the user can act
      // on rather than a thrown Postgres error.
      const [author] = await sql<{ id: number }[]>`
        SELECT id::int FROM users WHERE id = ${input.commentAuthorId}
      `;

      if (!author) {
        return {
          ok: false,
          errors: {
            commentAuthorId: ["That comment author no longer exists."],
          },
          message: "Missing fields. Failed to create the task.",
        };
      }

      try {
        const [row] = await sql.begin(async (tx) => {
          const [task] = await tx<{ id: number }[]>`
            INSERT INTO tasks (
              project_id, assignee_id, title, description, status, created_at, updated_at
            )
            VALUES (
              ${input.projectId}, ${assigneeId}, ${title}, ${description}, ${status}, now(), now()
            )
            RETURNING id::int AS id
          `;

          // Inside the same transaction, so a failure here throws and the task
          // insert above is rolled back with it.
          await tx`
            INSERT INTO comments (task_id, author_id, body, created_at)
            VALUES (${task.id}, ${input.commentAuthorId}, ${comment.data.commentBody}, now())
          `;

          return [task];
        });

        return { ok: true, id: row.id };
      } catch (error) {
        console.error("Database Error:", error);
        return {
          ok: false,
          message: "Database Error: Failed to create the task.",
        };
      }
    }),
});
