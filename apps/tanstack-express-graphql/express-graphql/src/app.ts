// src/app.ts
//
// The app factory — the composition root.
//
// `createApp` builds the Express application and wires the layers together
// (GraphQL schema → resolvers → models → db). Tests import it and drive it
// with supertest rather than binding a port; `src/server.ts` is the only place
// that listens. The dependency is inverted: the server entry depends on the
// factory, never the reverse, so importing the app never opens a socket.
//
// The HTTP surface is two routes: `/healthz` (readiness, deliberately
// database-free) and `/graphql`, where GraphQL Yoga serves the schema. Yoga
// is mounted with `cors: false` because the Express `cors()` middleware in
// front of it owns cross-origin policy for the whole app — the SPA is a
// separate origin — and letting both set CORS headers would decide it in two
// places instead of one.

import express, { type Express } from "express";
import cors from "cors";
import { createYoga } from "graphql-yoga";

import { requirePostgresUrl } from "./config/env.ts";
import { createConnection } from "./db/connection.ts";
import { mountHealthRoutes } from "./health/health.routes.ts";
import { createDashboardModel } from "./dashboard/dashboard.model.ts";
import { createProjectsModel } from "./projects/projects.model.ts";
import { createTasksModel } from "./tasks/tasks.model.ts";
import { createUsersModel } from "./users/users.model.ts";
import { createGraphqlSchema } from "./graphql/schema.ts";
import { maskError } from "./graphql/masked-errors.ts";

export interface CreateAppOptions {
  /**
   * Overrides the Postgres connection string the app's data layer uses.
   *
   * Integration tests point this at the isolated test database; production
   * omits it and `src/config/env.ts` supplies the value.
   */
  postgresUrl?: string;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();

  // Don't advertise the framework to clients.
  app.disable("x-powered-by");

  // The frontend is a separate origin (Vite dev server / SPA host), so every
  // request the client makes is cross-origin. Origins are reflected rather
  // than allowlisted: this API serves no cookies or credentials, so there is
  // nothing a reflected origin could smuggle. A credentialed API would need an
  // explicit allowlist instead.
  app.use(cors({ origin: true }));

  // The dependency chain, composed here and nowhere else: connection →
  // models → resolvers → schema → yoga. Each layer sees only the layer below
  // it; the models are unchanged from the REST variant, because they never
  // knew about HTTP in the first place.
  const db = createConnection(requirePostgresUrl(options.postgresUrl));
  const schema = createGraphqlSchema({
    usersModel: createUsersModel(db),
    tasksModel: createTasksModel(db),
    projectsModel: createProjectsModel(db),
    dashboardModel: createDashboardModel(db),
  });

  const yoga = createYoga({
    schema,
    // Bound to the one endpoint so the playground (GraphiQL) does not render
    // on any other path.
    graphqlEndpoint: "/graphql",
    graphiql: true,
    // The Express cors() middleware above owns cross-origin policy.
    cors: false,
    // The deliberate outcomes this API answers with are GraphQLErrors whose
    // messages ARE the contract (validation messages, FK guard messages) —
    // those are never masked. Everything else (a database error a model
    // rethrew, a bug) is masked with the same generic line the REST variant's
    // error handler answered 500s with, so internals never reach the client.
    //
    // `maskError` is supplied rather than left to Yoga's default because the
    // default decides by `instanceof GraphQLError`, which is module-identity-
    // sensitive; see src/graphql/masked-errors.ts for why that masks our own
    // deliberate errors under a different loader.
    maskedErrors: { errorMessage: "Internal server error", maskError },
  });

  mountHealthRoutes(app);
  app.use(yoga.graphqlEndpoint, yoga);

  return app;
}
