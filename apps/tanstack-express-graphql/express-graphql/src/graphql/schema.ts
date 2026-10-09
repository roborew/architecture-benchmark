// src/graphql/schema.ts
//
// The composition of the schema: the SDL (type-defs.ts) plus the four
// domains' resolver slices, merged into the single resolver map GraphQL
// expects. Each domain's factory sees only the model it was composed with —
// the same layering the REST variant's controllers had, with the router's
// URL→method mapping replaced by the operation names the SDL declares.

import { createSchema } from "graphql-yoga";

import type { DashboardModel } from "../dashboard/dashboard.model.ts";
import { createDashboardResolvers } from "../dashboard/dashboard.resolvers.ts";
import type { ProjectsModel } from "../projects/projects.model.ts";
import { createProjectsResolvers } from "../projects/projects.resolvers.ts";
import type { TasksModel } from "../tasks/tasks.model.ts";
import { createTasksResolvers } from "../tasks/tasks.resolvers.ts";
import type { UsersModel } from "../users/users.model.ts";
import { createUsersResolvers } from "../users/users.resolvers.ts";
import { typeDefs } from "./type-defs.ts";

/** The models the schema is composed from — wired by src/app.ts, nowhere else. */
export interface GraphqlModels {
  usersModel: UsersModel;
  tasksModel: TasksModel;
  projectsModel: ProjectsModel;
  dashboardModel: DashboardModel;
}

export function createGraphqlSchema(models: GraphqlModels) {
  const users = createUsersResolvers(models.usersModel);
  const tasks = createTasksResolvers(models.tasksModel);
  const projects = createProjectsResolvers(models.projectsModel);
  const dashboard = createDashboardResolvers(models.dashboardModel);

  return createSchema({
    typeDefs,
    resolvers: {
      Query: {
        ...users.Query,
        ...tasks.Query,
        ...projects.Query,
        ...dashboard.Query,
      },
      Mutation: {
        ...users.Mutation,
        ...tasks.Mutation,
        ...projects.Mutation,
      },
    },
  });
}
