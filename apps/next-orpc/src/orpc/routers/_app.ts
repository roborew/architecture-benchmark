// The application router: every domain, assembled in one place.
//
// The direct counterpart to src/trpc/routers/_app.ts. Only `users` has been
// migrated so far; the other three (projects, tasks, comments) still live behind
// tRPC in src/trpc/routers/, and are added here one at a time as their contracts
// land. Until then this router serves a subset of the API surface that
// src/trpc/routers/_app.ts serves, which is expected mid-migration.

import { usersContract } from "../contract";
import { usersRouter } from "./users";

// `os` is the plain router builder from @orpc/server. Unlike `implement`, it
// takes routers rather than contracts and infers their types — the right tool for
// assembling already-implemented domains into a root.
import { os } from "@orpc/server";

export const router = os.router({
  users: usersRouter,
});

// The full contract is exported alongside the router because the client needs a
// type, and `RouterClient<typeof router>` is the one the docs recommend for a
// server-side router. It is kept here so a single import gives both the runtime
// router and the type its clients are checked against.
export type AppRouter = typeof router;

/**
 * The contract object as a whole.
 *
 * Not needed by the RPC client — `createORPCClient(link)` against `router` types
 * just fine — but this is what an OpenAPI Link or an `OpenAPIGenerator` would
 * consume, so it is assembled now while the shape is still being decided.
 */
export const contract = {
  users: usersContract,
};

export type AppContract = typeof contract;
