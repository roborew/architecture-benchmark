// The projects domain: reads wrapped from src/lib/data.ts, writes migrated from
// the createProject/updateProject/deleteProject Server Actions.
//
// Same contract as the users router — see trpc/result.ts for why a refused write
// returns `{ ok: false }` rather than throwing. Validating inside the resolver
// (rather than in `.input()`) is what keeps `errors` in the
// `{ fieldName: string[] }` shape the form already renders.

import { z } from "zod";

import { sql } from "@/lib/db";
import {
  getDashboardProjects,
  getProject,
  getProjects,
  getProjectTasks,
} from "@/lib/data";
import { baseProcedure, createTRPCRouter } from "../init";
import type { ActionResult, FieldErrors } from "../result";

const ProjectSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Project name is required.")
    // The schema puts no limit on projects.name, but tasks.title caps at 200.
    .max(200, "Project name must be 200 characters or fewer."),
  description: z.string().trim(),
});

function fieldErrors(error: z.ZodError): FieldErrors {
  return error.flatten().fieldErrors;
}

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
        // An omitted description is legal — the column defaults to '' — so the
        // input does not demand one. `ProjectSchema` still validates the value
        // once present, which is what puts a message against the textarea.
        description: z.string().optional(),
      }),
    )
    .mutation(async ({ input }): Promise<ActionResult> => {
      const parsed = ProjectSchema.safeParse({
        name: input.name,
        description: input.description ?? "",
      });

      if (!parsed.success) {
        return {
          ok: false,
          errors: fieldErrors(parsed.error),
          message: "Missing fields. Failed to create project.",
        };
      }

      const { name, description } = parsed.data;

      try {
        // created_at is NOT NULL with no default, so the server sets it.
        // RETURNING id so the client has the row it just created.
        const [row] = await sql<{ id: number }[]>`
          INSERT INTO projects (name, description, created_at)
          VALUES (${name}, ${description}, now())
          RETURNING id::int AS id
        `;

        return { ok: true, id: row.id };
      } catch (error) {
        console.error("Database Error:", error);
        return {
          ok: false,
          message: "Database Error: Failed to create project.",
        };
      }
    }),

  update: baseProcedure
    .input(
      z.object({
        id: z.number().int(),
        name: z.string(),
        description: z.string().optional(),
      }),
    )
    .mutation(async ({ input }): Promise<ActionResult> => {
      const { id } = input;
      const parsed = ProjectSchema.safeParse({
        name: input.name,
        description: input.description ?? "",
      });

      if (!parsed.success) {
        return {
          ok: false,
          errors: fieldErrors(parsed.error),
          message: "Missing fields. Failed to update project.",
        };
      }

      const { name, description } = parsed.data;

      try {
        // RETURNING distinguishes "no such row" from "row updated", so a stale
        // form cannot report success for a project that is already gone.
        const updated = await sql<{ id: number }[]>`
          UPDATE projects
          SET name = ${name}, description = ${description}
          WHERE id = ${id}
          RETURNING id
        `;

        if (updated.length === 0) {
          return { ok: false, message: "That project no longer exists." };
        }
      } catch (error) {
        console.error("Database Error:", error);
        return {
          ok: false,
          message: "Database Error: Failed to update project.",
        };
      }

      return { ok: true, id };
    }),

  delete: baseProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }): Promise<ActionResult> => {
      const { id } = input;

      try {
        const deleted = await sql<{ id: number }[]>`
          DELETE FROM projects WHERE id = ${id} RETURNING id
        `;

        if (deleted.length === 0) {
          return { ok: false, message: "That project no longer exists." };
        }
      } catch (error) {
        // tasks.project_id is ON DELETE RESTRICT, so a project that still has
        // tasks cannot be removed. 23001 is restrict_violation; 23503 is what
        // NO ACTION raises, and both mean the same thing here. This is a rule the
        // user can act on, so it is reported rather than thrown.
        const code = (error as { code?: string }).code;

        if (code === "23001" || code === "23503") {
          const [row] = await sql<{ count: number }[]>`
            SELECT COUNT(*)::int AS count FROM tasks WHERE project_id = ${id}
          `;

          const count = row?.count ?? 0;

          return {
            ok: false,
            message:
              count === 1
                ? "This project still has 1 task. Delete it before deleting the project."
                : `This project still has ${count} tasks. Delete them before deleting the project.`,
          };
        }

        console.error("Database Error:", error);
        return {
          ok: false,
          message: "Database Error: Failed to delete project.",
        };
      }

      return { ok: true, id };
    }),
});
