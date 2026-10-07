// src/orpc/contract.ts
//
// The application contract: what the transport promises, with no implementation.
//
// Every procedure is an `oc` contract — the input/output shapes both sides
// agree on, with no logic inside. This file is the SPA's half of a MIRRORED
// PAIR: the API's own copy (../../express-orpc/src/orpc/contract.ts) drives
// `implement(...)` on the server and is the source of truth; this copy types
// the client (`RouterContractClient<typeof contract>`) without importing any
// server code. The SPA is a standalone package (this repo has no shared
// workspace), so the contract travels as a pair rather than a shared import —
// the same convention the REST variant used for its row types. The two files
// must move together — a procedure renamed on one side is a compile error
// there and a NOT_FOUND on the other, so neither can drift silently.
//
// The input split mirrors what the REST surface carried, and where:
//
//   * ids the client already owns (`id`, `projectId`, `assigneeId`, `limit`)
//     are typed values (numbers) — under REST these rode in the URL or were
//     already typed members of a filter object, so the client converted them.
//   * write bodies are the form's field bag, verbatim: every field a loose
//     nullish string, because that is what a <form> submits and the SERVER
//     owns every normalisation rule (an empty assignee means "unassigned", a
//     numeric string is a row id). Value validation is deliberately NOT here:
//     a blank title is user error the form renders, so it is checked by the
//     domain validators, whose messages are the reference variant's zod
//     schemas verbatim. This `.input()` only checks the SHAPE the caller was
//     supposed to send — which fields exist, and that each is the string a
//     form control produces.
//
// `.meta(openapi(...))` declares the REST path each procedure also answers on
// through the API's OpenAPI handler at /api, mirroring the REST surface this
// app replaced. The RPC path the SPA actually calls is derived from the router
// shape, so the metadata is a second protocol on top of it rather than the only
// routing story.

import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import { z } from "zod";

import {
  CommentSchema,
  DashboardDataSchema,
  MutationResultSchema,
  ProjectSchema,
  ProjectTaskRowSchema,
  TaskRowSchema,
  TaskSchema,
  UserSchema,
} from "./schemas.ts";

/** One field of a form bag: a string, present or not. */
const field = z.string().nullish();

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------

export const usersContract = {
  list: oc
    .meta(openapi({ method: "GET", path: "/users", summary: "List people" }))
    .input(z.object({ q: z.string().optional() }).optional())
    .output(z.array(UserSchema)),

  byId: oc
    .meta(
      openapi({ method: "GET", path: "/users/{id}", summary: "One person" }),
    )
    .input(z.object({ id: z.number().int() }))
    // NOT_FOUND when no row matches, thrown by the router — the output is
    // the row itself, so a client cannot render a missing member by accident.
    .output(UserSchema),

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
    .output(z.array(TaskSchema)),

  create: oc
    .meta(
      openapi({ method: "POST", path: "/users", summary: "Create a person" }),
    )
    .input(z.object({ name: field, email: field }))
    .output(MutationResultSchema),

  update: oc
    .meta(
      openapi({
        method: "PATCH",
        path: "/users/{id}",
        summary: "Update a person",
      }),
    )
    .input(z.object({ id: z.number().int(), name: field, email: field }))
    .output(MutationResultSchema),

  remove: oc
    .meta(
      openapi({
        method: "DELETE",
        path: "/users/{id}",
        summary: "Delete a person",
      }),
    )
    .input(z.object({ id: z.number().int() }))
    .output(MutationResultSchema),
};

// ---------------------------------------------------------------------------
// projects
// ---------------------------------------------------------------------------

export const projectsContract = {
  list: oc
    .meta(
      openapi({ method: "GET", path: "/projects", summary: "List projects" }),
    )
    .input(z.object({ q: z.string().optional() }).optional())
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
    .output(ProjectSchema),

  /**
   * One page of a project's board. The status and cursor stay optional so a
   * page can ask for "the first page of everything" without naming every
   * filter.
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
        status: field,
        cursor: field,
        limit: z.number().int().nullish(),
      }),
    )
    .output(z.array(ProjectTaskRowSchema)),

  create: oc
    .meta(
      openapi({
        method: "POST",
        path: "/projects",
        summary: "Create a project",
      }),
    )
    .input(z.object({ name: field, description: field }))
    .output(MutationResultSchema),

  update: oc
    .meta(
      openapi({
        method: "PATCH",
        path: "/projects/{id}",
        summary: "Update a project",
      }),
    )
    .input(z.object({ id: z.number().int(), name: field, description: field }))
    .output(MutationResultSchema),

  remove: oc
    .meta(
      openapi({
        method: "DELETE",
        path: "/projects/{id}",
        summary: "Delete a project",
      }),
    )
    .input(z.object({ id: z.number().int() }))
    .output(MutationResultSchema),
};

// ---------------------------------------------------------------------------
// tasks
// ---------------------------------------------------------------------------

/**
 * The filters both `list` and `count` accept.
 *
 * Shared so the two cannot drift: the list page fetches a page and its total
 * separately, and a filter accepted by one but not the other would show a
 * count that disagrees with the rows beneath it.
 */
const TaskFilterInput = z.object({
  q: field,
  status: field,
  projectId: z.number().int().nullish(),
  assigneeId: z.number().int().nullish(),
});

export const tasksContract = {
  list: oc
    .meta(openapi({ method: "GET", path: "/tasks", summary: "List tasks" }))
    .input(
      TaskFilterInput.extend({
        cursor: field,
        limit: z.number().int().nullish(),
      }),
    )
    .output(z.array(TaskRowSchema)),

  /**
   * The total matching the same filters `list` applies. A separate aggregate
   * on purpose: a window COUNT would force Postgres to materialise every
   * matching row before discarding all but the first page. Returns the bare
   * number — the RPC reply is the value, not a `{ count }` wrapper a second
   * module has to unwrap.
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
    .output(TaskSchema),

  /** The most recent comments on one task; spec/queries.md caps the read at 10. */
  comments: oc
    .meta(
      openapi({
        method: "GET",
        path: "/tasks/{id}/comments",
        summary: "A task's comments, newest first",
      }),
    )
    .input(z.object({ id: z.number().int() }))
    .output(z.array(CommentSchema)),

  create: oc
    .meta(openapi({ method: "POST", path: "/tasks", summary: "Create a task" }))
    .input(
      z.object({
        projectId: field,
        assigneeId: field,
        title: field,
        description: field,
        status: field,
      }),
    )
    .output(MutationResultSchema),

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
        projectId: field,
        assigneeId: field,
        title: field,
        description: field,
        status: field,
        commentBody: field,
        commentAuthorId: field,
      }),
    )
    .output(MutationResultSchema),

  // No `projectId`, deliberately. The contract lists the update form's fields
  // as title, status, assignee and description only, so accepting one here
  // would allow moving a task behind a form that never offers the choice.
  update: oc
    .meta(
      openapi({
        method: "PATCH",
        path: "/tasks/{id}",
        summary: "Update a task",
      }),
    )
    .input(
      z.object({
        id: z.number().int(),
        title: field,
        description: field,
        status: field,
        assigneeId: field,
      }),
    )
    .output(MutationResultSchema),

  remove: oc
    .meta(
      openapi({
        method: "DELETE",
        path: "/tasks/{id}",
        summary: "Delete a task",
      }),
    )
    .input(z.object({ id: z.number().int() }))
    .output(MutationResultSchema),

  /**
   * Comment on an existing task.
   *
   * The field names are the form's own (`body`/`authorId`), not the
   * with-comment form's (`commentBody`/`commentAuthorId`): the API keys its
   * validation errors by the names the caller actually sent, so the form that
   * renders those errors must submit the same spelling.
   */
  addComment: oc
    .meta(
      openapi({
        method: "POST",
        path: "/tasks/{id}/comments",
        summary: "Comment on a task",
      }),
    )
    .input(
      z.object({
        id: z.number().int(),
        body: field,
        authorId: field,
      }),
    )
    .output(MutationResultSchema),
};

// ---------------------------------------------------------------------------
// dashboard
// ---------------------------------------------------------------------------

export const dashboardContract = {
  /** The dashboard aggregate: stats, recent tasks and the busiest projects. */
  get: oc
    .meta(
      openapi({
        method: "GET",
        path: "/dashboard",
        summary: "The dashboard's three sections, in one reply",
      }),
    )
    .output(DashboardDataSchema),
};

// ---------------------------------------------------------------------------
// the assembled contract
// ---------------------------------------------------------------------------

/**
 * The contract object as a whole, assembled exactly as the API's own
 * routers/_app.ts assembles its copy — same keys, same order — so the
 * procedure paths the client derives from this shape are the paths the
 * API's router serves.
 */
export const contract = {
  users: usersContract,
  tasks: tasksContract,
  projects: projectsContract,
  dashboard: dashboardContract,
};

export type AppContract = typeof contract;
