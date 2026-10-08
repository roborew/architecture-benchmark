// src/projects/projects.resolvers.ts
//
// The resolver layer for projects: the REST controller's validation logic and
// message strings, ported verbatim onto GraphQL operations. The board's
// task-list arguments are validated by the tasks domain's pure validator,
// because the board's rows are task rows — exactly as the REST controller
// reached across for it.

import { requireIdArg, intArg, stringArg } from "../graphql/args.ts";
import {
  badInputError,
  conflictError,
  notFoundError,
  validationError,
} from "../graphql/graphql-error.ts";
import { parseSearchTerm } from "../lib/query.validator.ts";
import { parseProjectTaskListQuery } from "../tasks/tasks.validator.ts";
import type { ProjectsModel } from "./projects.model.ts";
import { parseProjectBody } from "./projects.validator.ts";

type ProjectBodyArgs = {
  name?: string | null;
  description?: string | null;
};

type ProjectTasksArgs = {
  projectId: number;
  status?: string | null;
  cursor?: string | null;
  limit?: number | null;
};

export function createProjectsResolvers(model: ProjectsModel) {
  return {
    Query: {
      /** Every project with its aggregate counts. */
      async projects(_parent: unknown, args: { q?: string | null }) {
        const parsed = parseSearchTerm(stringArg(args.q));

        if (!parsed.ok) {
          throw badInputError(parsed.error);
        }

        return model.list(parsed.term);
      },

      /** One project, with the same shape the listing returns. */
      async project(_parent: unknown, args: { id: number }) {
        const id = requireIdArg(args.id);
        const project = await model.get(id);

        if (!project) {
          throw notFoundError("Not found");
        }

        return project;
      },

      /** One keyset page of a project's board. */
      async projectTasks(_parent: unknown, args: ProjectTasksArgs) {
        const projectId = requireIdArg(args.projectId);
        const parsed = parseProjectTaskListQuery({
          status: stringArg(args.status),
          cursor: stringArg(args.cursor),
          limit: intArg(args.limit),
        });

        if (!parsed.ok) {
          throw badInputError(parsed.error);
        }

        return model.listTasks(projectId, parsed.filters);
      },
    },

    Mutation: {
      /** Insert one project; the SPA navigates to its board next. */
      async createProject(_parent: unknown, args: ProjectBodyArgs) {
        const parsed = parseProjectBody(args);

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
      },

      /** Update one project by primary key. */
      async updateProject(
        _parent: unknown,
        args: ProjectBodyArgs & { id: number },
      ) {
        const id = requireIdArg(args.id);
        const parsed = parseProjectBody(args);

        if (!parsed.ok) {
          throw validationError(
            "Missing fields. Failed to update project.",
            parsed.errors,
          );
        }

        const result = await model.update(id, parsed.data);

        if (result.status === "missing") {
          throw notFoundError("That project no longer exists.");
        }

        return {
          ok: true as const,
          message: "Project updated.",
          redirectTo: `/projects/${id}`,
        };
      },

      /** Delete one project, or a conflict while it still has tasks. */
      async deleteProject(_parent: unknown, args: { id: number }) {
        const id = requireIdArg(args.id);
        const result = await model.remove(id);

        if (result.status === "missing") {
          throw notFoundError("That project no longer exists.");
        }

        if (result.status === "restricted") {
          // A project that still has tasks cannot be removed (FK RESTRICT); the
          // reference reports why as an actionable message, which this API
          // answers with the same string as a conflict.
          throw conflictError(result.message);
        }

        return {
          ok: true as const,
          message: "Project deleted.",
          redirectTo: "/projects",
        };
      },
    },
  };
}
