// src/app.ts
//
// The app factory — the composition root.
//
// `buildApp` builds the Fastify application. Tests import it and drive it with
// `app.inject()` (light-my-request: a fake HTTP transport that awaits the
// app's boot and dispatches the request in-process — no socket is ever
// bound); `src/server.ts` is the only place that listens. The dependency is
// inverted: the server entry depends on the factory, never the reverse, so
// importing the app never opens a port.
//
// Where the Express variant mounts a middleware chain, Fastify builds a plugin
// tree: registrations are queued and applied when the instance boots (at the
// first `inject()`/`listen()`), and handlers that reject are forwarded to the
// registered error handler without any middleware having to catch them.

import Fastify, { type FastifyInstance } from "fastify";

import { requirePostgresUrl } from "./config/env.ts";
import { createConnection } from "./db/connection.ts";
import { mountHealthRoutes } from "./health/health.routes.ts";
import { errorHandler } from "./middleware/error-handler.ts";
import { notFoundHandler } from "./middleware/not-found.ts";

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

  // The framework's replacements for the terminal middleware pair the Express
  // variant mounts after every route: any handler that throws or rejects is
  // forwarded here (Express 5 needed no wrapper either, but its error
  // middleware had to be positioned by hand), and a route that matches
  // nothing lands in the not-found handler instead of a default HTML page.
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);

  // The Postgres connection, created per app so the `postgresUrl` override is
  // honored from the first build. postgres.js connects lazily — nothing
  // reaches the server until the first query — which is exactly what the
  // healthz contract relies on. The domain models and routes that consume it
  // land with each domain's REST surface; until then there is nothing to
  // query.
  const db = createConnection(requirePostgresUrl(options.postgresUrl));

  mountHealthRoutes(app);

  return app;
}
