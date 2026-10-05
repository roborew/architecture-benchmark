// The application router: every domain, assembled in one place.
//
// The direct counterpart to src/trpc/routers/_app.ts, and now covering the whole
// surface rather than just `users`.
//
// One difference from the tRPC original: `os` here comes from the plain router
// builder, not an implementer, because it takes already-implemented routers
// rather than contracts. Each domain's own file used `implement(itsContract)`;
// this file only composes the results.

import { os } from "@orpc/server";

import {
  commentsContract,
  projectsContract,
  tasksContract,
  usersContract,
} from "../contract";
import { commentsRouter } from "./comments";
import { projectsRouter } from "./projects";
import { tasksRouter } from "./tasks";
import { usersRouter } from "./users";

export const router = os.router({
  users: usersRouter,
  projects: projectsRouter,
  tasks: tasksRouter,
  comments: commentsRouter,
});

export type AppRouter = typeof router;

/**
 * The contract object as a whole.
 *
 * Not needed by the RPC client — `createORPCClient(link)` against `router` types
 * just fine — but this is what an OpenAPI Link, an `OpenAPIGenerator` or an
 * `OpenAPIHandler` consumes, so it is assembled from the same per-domain
 * contracts the implementations are checked against.
 */
export const contract = {
  users: usersContract,
  projects: projectsContract,
  tasks: tasksContract,
  comments: commentsContract,
};

export type AppContract = typeof contract;
