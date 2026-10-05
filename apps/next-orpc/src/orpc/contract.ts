// The application contracts: what the transport promises, with no implementation.
//
// This is the v2 shape and it is the reason oRPC's contract-first style is worth
// the extra file. The tRPC routers could not declare their output: a tRPC router
// infers everything from its handlers, so the response type is only visible to
// TypeScript, never to the wire. An `oc` contract is separate from the handler
// and every `.output()` is both
//
//   * the schema the server validates its reply against at runtime, and
//   * the type the client sees.
//
// The shared row schemas live in ./schemas, so a row cannot be described one way
// for users and another for tasks.
//
// The `ActionResult` union is deliberately NOT an oRPC error. A blank name or a
// foreign key blocking a delete is ordinary user error that the form already
// renders, and `src/lib/result.ts` explains why that is a value rather than a
// thrown error. See that file before "fixing" this.
//
// `.meta(openapi(...))` is v2's replacement for the removed `.route` / `.prefix`
// builder methods. The RPC path is derived from the router shape, so the OpenAPI
// path is metadata on top of it rather than the only routing story.

import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import { z } from "zod";

import {
  ActionResultSchema,
  CommentSchema,
  DashboardProjectSchema,
  DashboardStatsSchema,
  DashboardTaskSchema,
  ProjectSchema,
  ProjectTaskRowSchema,
  TaskRowSchema,
  TaskWithProjectSchema,
  UserSchema,
} from "./schemas";

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------

export const usersContract = {
  list: oc
    .meta(openapi({ method: "GET", path: "/users", summary: "List people" }))
    .input(z.object({ search: z.string().optional() }).optional())
    .output(z.array(UserSchema)),

  byId: oc
    .meta(
      openapi({ method: "GET", path: "/users/{id}", summary: "One person" }),
    )
    .input(z.object({ id: z.number().int() }))
    // `null` when no row matches, which is a successful read of a missing row.
    .output(UserSchema.nullable()),

  /** The tasks assigned to one member, scoped by assignee_id rather than name. */
  tasks: oc
    .meta(
      openapi({
        method: "GET",
        path: "/users/{id}/tasks",
        summary: "Tasks assigned to a person",
      }),
    )
    .input(z.object({ id: z.number().int() }))
    .output(z.array(TaskWithProjectSchema)),

  // Value validation of name/email is NOT here: a blank name is user error that
  // the form renders, so it is checked inside data.ts and returns
  // `{ ok: false, errors }`. This `.input()` only checks the SHAPE the caller was
  // supposed to send.
  create: oc
    .meta(
      openapi({ method: "POST", path: "/users", summary: "Create a person" }),
    )
    .input(z.object({ name: z.string(), email: z.string() }))
    .output(ActionResultSchema),

  update: oc
    .meta(
      openapi({
        method: "PUT",
        path: "/users/{id}",
        summary: "Update a person",
      }),
    )
    .input(
      z.object({ id: z.number().int(), name: z.string(), email: z.string() }),
    )
    .output(ActionResultSchema),

  delete: oc
    .meta(
      openapi({
        method: "DELETE",
        path: "/users/{id}",
        summary: "Delete a person",
      }),
    )
    .input(z.object({ id: z.number().int() }))
    .output(ActionResultSchema),
};

// ---------------------------------------------------------------------------
// projects
// ---------------------------------------------------------------------------

export const projectsContract = {
  list: oc
    .meta(
      openapi({ method: "GET", path: "/projects", summary: "List projects" }),
    )
    .input(z.object({ search: z.string().optional() }).optional())
    .output(z.array(ProjectSchema)),

  byId: oc
    .meta(
      openapi({
        method: "GET",
        path: "/projects/{id}",
        summary: "One project",
      }),
    )
    .input(z.object({ id: z.number().int() }))
    .output(ProjectSchema.nullable()),

  /**
   * The busiest projects, for the dashboard's cards.
   *
   * Ordered by task count, so these cards answer "where is the work?" rather than
   * repeating the newest-first ordering every other project list uses.
   */
  dashboard: oc
    .meta(
      openapi({
        method: "GET",
        path: "/projects/dashboard",
        summary: "Busiest projects, for the dashboard",
      }),
    )
    .input(z.object({ limit: z.number().int().optional() }).optional())
    .output(z.array(DashboardProjectSchema)),

  /**
   * One page of a project's tasks. The status and cursor stay optional so a page
   * can ask for "the first page of everything" without naming every filter.
   */
  tasks: oc
    .meta(
      openapi({
        method: "GET",
        path: "/projects/{id}/tasks",
        summary: "A page of a project's task board",
      }),
    )
    .input(
      z.object({
        id: z.number().int(),
        status: z.string().optional(),
        cursor: z.string().nullish(),
        limit: z.number().int().optional(),
      }),
    )
    .output(z.array(ProjectTaskRowSchema)),

  // Value validation of name/description is NOT here: a blank name is user error
  // that the form renders, so it is checked inside data.ts and returns
  // `{ ok: false, errors }`. This `.input()` only checks the SHAPE the caller was
  // supposed to send.
  create: oc
    .meta(
      openapi({
        method: "POST",
        path: "/projects",
        summary: "Create a project",
      }),
    )
    .input(z.object({ name: z.string(), description: z.string().optional() }))
    .output(ActionResultSchema),

  update: oc
    .meta(
      openapi({
        method: "PUT",
        path: "/projects/{id}",
        summary: "Update a project",
      }),
    )
    .input(
      z.object({
        id: z.number().int(),
        name: z.string(),
        description: z.string().optional(),
      }),
    )
    .output(ActionResultSchema),

  delete: oc
    .meta(
      openapi({
        method: "DELETE",
        path: "/projects/{id}",
        summary: "Delete a project",
      }),
    )
    .input(z.object({ id: z.number().int() }))
    .output(ActionResultSchema),
};

// ---------------------------------------------------------------------------
// tasks
// ---------------------------------------------------------------------------

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

export const tasksContract = {
  list: oc
    .meta(openapi({ method: "GET", path: "/tasks", summary: "List tasks" }))
    .input(
      TaskFilterInput.extend({
        cursor: z.string().nullish(),
        limit: z.number().int().optional(),
      }),
    )
    .output(z.array(TaskRowSchema)),

  /**
   * The total matching the same filters `list` applies. A separate aggregate on
   * purpose: a window COUNT would force Postgres to materialise every matching row
   * before discarding all but the first page.
   */
  count: oc
    .meta(
      openapi({
        method: "GET",
        path: "/tasks/count",
        summary: "Total tasks matching a filter",
      }),
    )
    .input(TaskFilterInput)
    .output(z.number().int()),

  byId: oc
    .meta(openapi({ method: "GET", path: "/tasks/{id}", summary: "One task" }))
    .input(z.object({ id: z.number().int() }))
    .output(TaskWithProjectSchema.nullable()),

  /** The most recent comments on one task; spec/queries.md caps the page at 10. */
  comments: oc
    .meta(
      openapi({
        method: "GET",
        path: "/tasks/{id}/comments",
        summary: "A task's comments, newest first",
      }),
    )
    .input(
      z.object({ id: z.number().int(), limit: z.number().int().optional() }),
    )
    .output(z.array(CommentSchema)),

  /**
   * Workspace totals for the dashboard's stat cards.
   *
   * One statement rather than three, because the cards render together and
   * separate COUNT queries would each scan a different table for the same row.
   */
  dashboardStats: oc
    .meta(
      openapi({
        method: "GET",
        path: "/tasks/dashboard-stats",
        summary: "Workspace totals, for the dashboard",
      }),
    )
    .output(DashboardStatsSchema),

  /**
   * The most recently updated tasks, for the dashboard's recent table.
   *
   * Ordered by `updated_at` rather than `created_at`: "recent activity" means when
   * the work last moved, which is also what `updateTask` advances.
   */
  recent: oc
    .meta(
      openapi({
        method: "GET",
        path: "/tasks/recent",
        summary: "Recently updated tasks, for the dashboard",
      }),
    )
    .input(z.object({ limit: z.number().int().optional() }).optional())
    .output(z.array(DashboardTaskSchema)),

  create: oc
    .meta(openapi({ method: "POST", path: "/tasks", summary: "Create a task" }))
    .input(
      z.object({
        title: z.string(),
        description: z.string().optional(),
        status: z.string(),
        projectId: z.number().int(),
        // nullish, never optional-only: spec/contract.md gives exactly one way to
        // unassign, and `null` is it. The data layer normalises an absent value to
        // it.
        assigneeId: z.number().int().nullish(),
      }),
    )
    .output(ActionResultSchema),

  // No `projectId`, deliberately. The contract lists the update form's fields as
  // title, status, assignee and description only, so accepting one here would
  // allow moving a task behind a form that never offers the choice.
  update: oc
    .meta(
      openapi({ method: "PUT", path: "/tasks/{id}", summary: "Update a task" }),
    )
    .input(
      z.object({
        id: z.number().int(),
        title: z.string(),
        description: z.string().optional(),
        status: z.string(),
        assigneeId: z.number().int().nullish(),
      }),
    )
    .output(ActionResultSchema),

  delete: oc
    .meta(
      openapi({
        method: "DELETE",
        path: "/tasks/{id}",
        summary: "Delete a task",
      }),
    )
    .input(z.object({ id: z.number().int() }))
    .output(ActionResultSchema),

  /**
   * Create a task and its first comment in one round-trip.
   *
   * The form collects both, and doing it as two procedures would leave a task
   * without its comment if the second write failed.
   */
  createWithComment: oc
    .meta(
      openapi({
        method: "POST",
        path: "/tasks/with-comment",
        summary: "Create a task together with its first comment",
      }),
    )
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
    .output(ActionResultSchema),
};

// ---------------------------------------------------------------------------
// comments
// ---------------------------------------------------------------------------

export const commentsContract = {
  /**
   * Comments have no standalone read here on purpose. A comment is only ever
   * shown in the context of its task, and spec/queries.md bounds that read at the
   * ten most recent — so `tasks.comments` is the one way to fetch them.
   */
  create: oc
    .meta(
      openapi({
        method: "POST",
        path: "/comments",
        summary: "Comment on a task",
      }),
    )
    .input(
      z.object({
        taskId: z.number().int(),
        commentBody: z.string(),
        commentAuthorId: z.number().int(),
      }),
    )
    .output(ActionResultSchema),
};
