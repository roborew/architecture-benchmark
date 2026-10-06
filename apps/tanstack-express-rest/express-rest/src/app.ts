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

import { mountHealthRoutes } from "./health/health.routes.ts";
import { errorHandler } from "./middleware/error-handler.ts";
import { notFound } from "./middleware/not-found.ts";

export interface CreateAppOptions {
  /**
   * Overrides the Postgres connection string the app's data layer uses.
   *
   * Integration tests point this at the isolated test database; production
   * omits it and `src/config/env.ts` supplies the value.
   */
  postgresUrl?: string;
}

export function createApp(_options: CreateAppOptions = {}): Express {
  const app = express();

  // Don't advertise the framework to clients.
  app.disable("x-powered-by");

  // JSON bodies for the write endpoints; a read-only GET ignores it.
  app.use(express.json());

  mountHealthRoutes(app);

  // Mounted after every route, before the error handler — order is the whole
  // contract of these two.
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
