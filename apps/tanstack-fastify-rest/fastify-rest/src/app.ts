// src/app.ts
//
// The app factory — the composition root.
//
// `buildApp` builds the Fastify application and wires the layers together
// (routes → controllers → models → db). Tests import it and drive it with
// `app.inject()` (light-my-request: a fake HTTP transport that awaits the
// app's boot and dispatches the request in-process — no socket is ever
// bound); `src/server.ts` is the only place that listens. The dependency is
// inverted: the server entry depends on the factory, never the reverse, so
// importing the app never opens a port.
//
// Where the Express variant mounts middleware (`express.json()`, `cors()`, an
// error-handling middleware at the end of the stack), Fastify builds a plugin
// tree: registrations are queued and applied when the instance boots (at the
// first `inject()`/`listen()`), and handlers that reject are forwarded to the
// registered error handler without any middleware having to catch them.

import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";

import { requirePostgresUrl } from "./config/env.ts";
import { createConnection } from "./db/connection.ts";
import { mountHealthRoutes } from "./health/health.routes.ts";
import { errorHandler } from "./middleware/error-handler.ts";
import { notFoundHandler } from "./middleware/not-found.ts";
import { createDashboardController } from "./dashboard/dashboard.controller.ts";
import { createDashboardModel } from "./dashboard/dashboard.model.ts";
import { dashboardRoutes } from "./dashboard/dashboard.routes.ts";
import { createProjectsController } from "./projects/projects.controller.ts";
import { createProjectsModel } from "./projects/projects.model.ts";
import { projectsRoutes } from "./projects/projects.routes.ts";
import { tasksRoutes } from "./tasks/tasks.routes.ts";
import { createTasksModel } from "./tasks/tasks.model.ts";
import { createTasksController } from "./tasks/tasks.controller.ts";
import { usersRoutes } from "./users/users.routes.ts";
import { createUsersModel } from "./users/users.model.ts";
import { createUsersController } from "./users/users.controller.ts";

export interface BuildAppOptions {
  /**
   * Overrides the Postgres connection string the app's data layer uses.
   *
   * Integration tests point this at the isolated test database; production
   * omits it and `src/config/env.ts` supplies the value.
   */
  postgresUrl?: string;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  // JSON bodies for the write endpoints are parsed by the framework itself —
  // there is no express.json() equivalent to mount, and a read-only GET never
  // pays for one. Fastify also never advertises itself in an x-powered-by
  // header, so there is nothing to disable.

  const app = Fastify();

  // The frontend is a separate origin (Vite dev server / SPA host), so every
  // fetch the client makes is cross-origin. Origins are reflected rather
  // than allowlisted: this API serves no cookies or credentials, so there is
  // nothing a reflected origin could smuggle. A credentialed API would need an
  // explicit allowlist instead.
  app.register(cors, {
    origin: true,
    methods: ["GET", "HEAD", "POST", "PATCH", "DELETE", "OPTIONS"],
  });

  // The framework's replacements for the terminal middleware pair the Express
  // variant mounts after every route: any handler that throws or rejects is
  // forwarded here (Express 5 needed no wrapper either, but its error
  // middleware had to be positioned by hand), and a route that matches
  // nothing lands in the not-found handler instead of a default HTML page.
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);

  // The dependency chain, composed here and nowhere else: connection →
  // model → controller → router. Each layer sees only the layer below it.
  const db = createConnection(requirePostgresUrl(options.postgresUrl));
  const usersModel = createUsersModel(db);
  const usersController = createUsersController(usersModel);
  const tasksModel = createTasksModel(db);
  const tasksController = createTasksController(tasksModel);
  const projectsModel = createProjectsModel(db);
  const projectsController = createProjectsController(projectsModel);
  const dashboardModel = createDashboardModel(db);
  const dashboardController = createDashboardController(dashboardModel);

  mountHealthRoutes(app);

  // The router's equivalent: an encapsulated plugin registered under a
  // prefix, so each routes file never sees its mount point and can be
  // mounted anywhere without changes — the same property the Express
  // variant gets from mounting a Router() under app.use("/api/…").
  app.register(usersRoutes, {
    prefix: "/api/users",
    controller: usersController,
  });
  app.register(tasksRoutes, {
    prefix: "/api/tasks",
    controller: tasksController,
  });
  app.register(projectsRoutes, {
    prefix: "/api/projects",
    controller: projectsController,
  });
  app.register(dashboardRoutes, {
    prefix: "/api/dashboard",
    controller: dashboardController,
  });

  return app;
}
