// src/app.ts
//
// The app factory — the composition root.
//
// `createApp` builds the Express application and wires the layers together
// (routers → models → db). Tests import it and drive it with the oRPC client
// against an ephemeral listener rather than binding the port production uses;
// `src/server.ts` is the only place that listens. The dependency is inverted:
// the server entry depends on the factory, never the reverse, so importing
// the app never opens a socket.
//
// Express's remaining job is the shell: CORS, the JSON body parser, the
// /healthz readiness endpoint, and the two oRPC handlers mounted as
// middleware — /rpc (the RPC protocol the SPA speaks) and /api (the same
// procedures as REST, from the contracts' OpenAPI metadata). There are no
// per-domain Express routes any more; the routing layer IS the oRPC router,
// and Express never sees a procedure's name.

import cors from "cors";
import express, { type Express } from "express";

import { requirePostgresUrl } from "./config/env.ts";
import { createConnection } from "./db/connection.ts";
import { mountHealthRoutes } from "./health/health.routes.ts";
import { errorHandler } from "./middleware/error-handler.ts";
import { notFound } from "./middleware/not-found.ts";
import { createAppRouter } from "./orpc/routers/_app.ts";
import { createHandlers } from "./orpc/handlers.ts";
import { createDashboardModel } from "./dashboard/dashboard.model.ts";
import { createProjectsModel } from "./projects/projects.model.ts";
import { createTasksModel } from "./tasks/tasks.model.ts";
import { createUsersModel } from "./users/users.model.ts";

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

  // JSON bodies for the write procedures; a read-only GET ignores it. oRPC
  // picks up the parsed body when it is available, so one global mount covers
  // both handlers below.
  app.use(express.json());

  // The frontend is a separate origin (Vite dev server / SPA host), so every
  // call the client makes is cross-origin. Origins are reflected rather
  // than allowlisted: this API serves no cookies or credentials, so there is
  // nothing a reflected origin could smuggle. A credentialed API would need an
  // explicit allowlist instead.
  app.use(cors({ origin: true }));

  // The dependency chain, composed here and nowhere else: connection →
  // models → oRPC routers. Each layer sees only the layer below it; the
  // routers are contract-checked against src/orpc/contract.ts.
  const db = createConnection(requirePostgresUrl(options.postgresUrl));
  const router = createAppRouter({
    users: createUsersModel(db),
    tasks: createTasksModel(db),
    projects: createProjectsModel(db),
    dashboard: createDashboardModel(db),
  });

  const { rpcHandler, openAPIHandler } = createHandlers(router);

  // The RPC protocol the SPA speaks. `matched` is false when no procedure
  // matched the path, so the fall-through 404 below answers it.
  app.use("/rpc{/*path}", async (req, res, next) => {
    const { matched } = await rpcHandler.handle(req, res, { prefix: "/rpc" });

    if (matched) return;

    next();
  });

  // The same procedures as REST (paths from the contracts' OpenAPI metadata),
  // plus the OpenAPI document at /api/spec.json and the Scalar UI at /api.
  app.use("/api{/*path}", async (req, res, next) => {
    const { matched } = await openAPIHandler.handle(req, res, {
      prefix: "/api",
    });

    if (matched) return;

    next();
  });

  mountHealthRoutes(app);

  // Mounted after every route, before the error handler — order is the whole
  // contract of these two.
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
