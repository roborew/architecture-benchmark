// src/server.ts
//
// The executable entry. The only module allowed to bind a port — importing
// `buildApp` anywhere else must never open a socket.
//
// Fastify's listen() resolves once the boot sequence (plugin registration,
// route compilation) has finished, unlike Express's fire-and-forget listen
// callback, so startup failures surface here as a rejected promise instead of
// an error event on the server object.

import { buildApp } from "./app.ts";
import { env } from "./config/env.ts";

const app = buildApp();

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  console.log(`[fastify-rest] listening on http://localhost:${env.PORT}`);
} catch (error) {
  console.error("[fastify-rest] failed to start:", error);
  process.exit(1);
}

// Graceful shutdown: stop accepting connections, let in-flight requests
// finish, and close the instance (Fastify runs its onClose hooks — the
// HTTP server itself is closed for us, rather than the Express variant's
// manual server.close()).
async function shutdown() {
  console.log("[fastify-rest] shutting down");
  await app.close();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
