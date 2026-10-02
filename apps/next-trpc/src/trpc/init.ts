import { initTRPC } from "@trpc/server";

/**
 * Takes a plain `Headers` rather than `next/headers` so the same function serves
 * both callers: the RSC caller (passes `await headers()`) and the route handler
 * (passes `req.headers`).
 *
 * Context is currently empty — this app has no auth. It's created here anyway so
 * adding a session later doesn't mean restructuring every router.
 */
export const createTRPCContext = async (opts: { headers: Headers }) => {
  return { headers: opts.headers };
};

const t = initTRPC
  .context<Awaited<ReturnType<typeof createTRPCContext>>>()
  // No transformer: src/lib/types.ts already stringifies timestamps, so plain
  // JSON round-trips every value. See ADR note in docs if this changes.
  .create();

export const createTRPCRouter = t.router;
export const createCallerFactory = t.createCallerFactory;
export const baseProcedure = t.procedure;
