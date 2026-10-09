// src/orpc/routers/projects.ts
//
// The projects domain: handlers that pass straight through to the model layer.
//
// The counterpart to the REST variant's projects.controller.ts. See that file
// and src/orpc/contract.ts for the shape rules doing real work; the
// behavioural contract is unchanged:
//
//   * The SQL, the validation and the `try`/`catch` all live in the model
//     (src/projects/projects.model.ts), the only module that talks to
//     Postgres.
//   * Value validation is not here. A blank name is user error the form
//     renders, so the pure validator owns it and its messages are the
//     reference variant's zod schemas verbatim.
//   * The project task board (`projects.tasks`) calls the tasks domain's
//     validator for its status value rule, because the board's rows are task
//     rows.

import { implement } from "@orpc/server";

import { parseSearchTerm } from "../../lib/query.validator.ts";
import type { ProjectsModel } from "../../projects/projects.model.ts";
import { parseProjectBody } from "../../projects/projects.validator.ts";
import { parseTaskStatus } from "../../tasks/tasks.validator.ts";
import { projectsContract } from "../contract.ts";
import { conflictError, notFoundError, validationError } from "../errors.ts";

const os = implement(projectsContract);

export function createProjectsRouter(model: ProjectsModel) {
  return os.router({
    list: os.list.handler(async ({ input }) => {
      const parsed = parseSearchTerm(input?.q);

      if (!parsed.ok) {
        throw validationError(parsed.error);
      }

      return model.list(parsed.term);
    }),

    byId: os.byId.handler(async ({ input }) => {
      const project = await model.get(input.id);

      if (!project) {
        throw notFoundError("Not found");
      }

      return project;
    }),

    tasks: os.tasks.handler(async ({ input }) => {
      const status = parseTaskStatus(input.status);

      if (!status.ok) {
        throw validationError(status.error);
      }

      return model.listTasks(input.id, {
        status: status.status,
        cursor: input.cursor ?? null,
        limit: input.limit ?? undefined,
      });
    }),

    create: os.create.handler(async ({ input }) => {
      const parsed = parseProjectBody(input);

      if (!parsed.ok) {
        throw validationError(
          "Missing fields. Failed to create project.",
          parsed.errors,
        );
      }

      const created = await model.create(parsed.data);

      return {
        ok: true as const,
        message: "Project created.",
        redirectTo: `/projects/${created.id}`,
      };
    }),

    update: os.update.handler(async ({ input }) => {
      const parsed = parseProjectBody(input);

      if (!parsed.ok) {
        throw validationError(
          "Missing fields. Failed to update project.",
          parsed.errors,
        );
      }

      const result = await model.update(input.id, parsed.data);

      if (result.status === "missing") {
        throw notFoundError("That project no longer exists.");
      }

      return {
        ok: true as const,
        message: "Project updated.",
        redirectTo: `/projects/${input.id}`,
      };
    }),

    remove: os.remove.handler(async ({ input }) => {
      const result = await model.remove(input.id);

      if (result.status === "missing") {
        throw notFoundError("That project no longer exists.");
      }

      if (result.status === "restricted") {
        // A project that still has tasks cannot be removed (FK RESTRICT); the
        // reference reports why as an actionable message, which this API
        // answers as a CONFLICT with the same string.
        throw conflictError(result.message);
      }

      return {
        ok: true as const,
        message: "Project deleted.",
        redirectTo: "/projects",
      };
    }),
  });
}

export type ProjectsRouter = ReturnType<typeof createProjectsRouter>;
