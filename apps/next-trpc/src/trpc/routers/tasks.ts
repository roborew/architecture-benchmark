// The tasks domain: transport only.
//
// Every procedure here is a one-line pass-through. The SQL, the validation, the
// foreign-key pre-checks and the `try`/`catch` all live in src/lib/data.ts, which
// is the only module that talks to Postgres.
//
// `.input()` checks the input's SHAPE, which is a client bug rather than user
// error, so it surfaces as a TRPCError. Two shape rules are doing real work here:
//
//   * `assigneeId` is `null`-able and never optional-only, because
//     spec/contract.md gives exactly one way to unassign. `null` means
//     "unassigned"; the data layer normalises an absent value to it.
//   * `update` has no `projectId` at all. The contract lists the update form's
//     fields as title, status, assignee and description only, so accepting one
//     would allow moving a task behind a form that never offers the choice.

import { z } from "zod";

import {
  countTasks,
  createTask,
  createTaskWithComment,
  deleteTask,
  getComments,
  getDashboardStats,
  getRecentTasks,
  getTask,
  getTasks,
  updateTask,
} from "@/lib/data";
import { baseProcedure, createTRPCRouter } from "../init";

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
  count: baseProcedure
    .input(TaskFilterInput)
    .query(({ input }) => countTasks(input)),

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
   * the work last moved, which is also what `updateTask` advances.
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
    .mutation(({ input }) => createTask(input)),

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
    .mutation(({ input }) => updateTask(input)),

  delete: baseProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(({ input }) => deleteTask(input.id)),

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
    .mutation(({ input }) => createTaskWithComment(input)),
});
