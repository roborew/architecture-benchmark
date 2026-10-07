// src/app.ts
//
// The app factory — the composition root.
//
// `createApp` builds the Express application and wires the layers together
// (routes → controllers → models → db). Tests import it and drive it with
// supertest rather than binding a port; `src/server.ts` is the only place that
// listens. The dependency is inverted: the server entry depends on the factory,
// never the reverse, so importing the app never opens a socket.

import express, { type Express } from "express";
import cors from "cors";

import { requirePostgresUrl } from "./config/env.ts";
import { createConnection } from "./db/connection.ts";
import { mountHealthRoutes } from "./health/health.routes.ts";
import { errorHandler } from "./middleware/error-handler.ts";
import { notFound } from "./middleware/not-found.ts";
import { createUsersController } from "./users/users.controller.ts";
import { createUsersModel } from "./users/users.model.ts";
import { createUsersRouter } from "./users/users.routes.ts";
import { createTasksRouter } from "./tasks/tasks.routes.ts";
import { createTasksModel } from "./tasks/tasks.model.ts";
import { createTasksController } from "./tasks/tasks.controller.ts";

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

  // JSON bodies for the write endpoints; a read-only GET ignores it.
  app.use(express.json());

  // The frontend is a separate origin (Vite dev server / SPA host), so every
  // fetch the client makes is cross-origin. Origins are reflected rather
  // than allowlisted: this API serves no cookies or credentials, so there is
  // nothing a reflected origin could smuggle. A credentialed API would need an
  // explicit allowlist instead.
  app.use(cors({ origin: true }));

  // The dependency chain, composed here and nowhere else: connection →
  // model → controller → router. Each layer sees only the layer below it.
  const db = createConnection(requirePostgresUrl(options.postgresUrl));
  const usersModel = createUsersModel(db);
  const usersController = createUsersController(usersModel);
  const tasksModel = createTasksModel(db);
  const tasksController = createTasksController(tasksModel);

  mountHealthRoutes(app);
  app.use("/api/users", createUsersRouter(usersController));
  app.use("/api/tasks", createTasksRouter(tasksController));

  // Mounted after every route, before the error handler — order is the whole
  // contract of these two.
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
