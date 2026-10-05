// The projects domain: transport only.
//
// Every procedure here is a one-line pass-through. The SQL, the validation and
// the `try`/`catch` all live in src/lib/data.ts, which is the only module that
// talks to Postgres — see `createProject`, `updateProject` and `deleteProject`
// there.
//
// `.input()` checks the input's SHAPE, which is a client bug rather than user
// error, so it surfaces as a TRPCError. Validating the VALUES is not here: a blank
// name is rendered in the form, and it comes back from the data layer as
// `{ ok: false, errors }`.

import { z } from "zod";

import {
  createProject,
  deleteProject,
  getDashboardProjects,
  getProject,
  getProjects,
  getProjectTasks,
  updateProject,
} from "@/lib/data";
import { baseProcedure, createTRPCRouter } from "../init";

export const projectsRouter = createTRPCRouter({
  list: baseProcedure
    .input(z.object({ search: z.string().optional() }).optional())
    .query(({ input }) => getProjects(input?.search ?? "")),

  byId: baseProcedure
    .input(z.object({ id: z.number().int() }))
    .query(({ input }) => getProject(input.id)),

  /**
   * The busiest projects, for the dashboard's cards.
   *
   * Ordered by task count, so these cards answer "where is the work?" rather than
   * repeating the newest-first ordering every other project list uses.
   */
  dashboard: baseProcedure
    .input(z.object({ limit: z.number().int().optional() }).optional())
    .query(({ input }) => getDashboardProjects(input?.limit)),

  /**
   * One page of a project's tasks. The status and cursor stay optional so a page
   * can ask for "the first page of everything" without naming every filter.
   */
  tasks: baseProcedure
    .input(
      z.object({
        id: z.number().int(),
        status: z.string().optional(),
        cursor: z.string().nullish(),
        limit: z.number().int().optional(),
      }),
    )
    .query(({ input }) =>
      getProjectTasks(input.id, {
        status: input.status,
        cursor: input.cursor ?? null,
        limit: input.limit,
      }),
    ),

  create: baseProcedure
    .input(
      z.object({
        name: z.string(),
        description: z.string().optional(),
      }),
    )
    .mutation(({ input }) => createProject(input)),

  update: baseProcedure
    .input(
      z.object({
        id: z.number().int(),
        name: z.string(),
        description: z.string().optional(),
      }),
    )
    .mutation(({ input }) => updateProject(input)),

  delete: baseProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(({ input }) => deleteProject(input.id)),
});
