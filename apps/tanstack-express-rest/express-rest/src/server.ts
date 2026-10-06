// src/server.ts
//
// The executable entry. The only module allowed to bind a port — importing
// `createApp` anywhere else must never open a socket.

import { createApp } from "./app.ts";
import { env } from "./config/env.ts";

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`[express-rest] listening on http://localhost:${env.PORT}`);
});

// Graceful shutdown: stop accepting connections, let in-flight requests
// finish, and don't let a stuck keep-alive connection hold the process.
function shutdown() {
  console.log("[express-rest] shutting down");
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
