import { initTRPC } from "@trpc/server";

/**
 * No `.context<>()`.
 *
 * An earlier version declared a `{ headers }` context, which baked `ctx` into
 * AppRouter's type. `createTRPCContext<AppRouter>()` in trpc/client.tsx then
 * resolved to its SERVER overload, so `useTRPC()` was typed as a
 * TRPCOptionsProxy — an object with no `useUtils` and no `useMutation` — and
 * every client hook failed to typecheck.
 *
 * A client reaches the router over HTTP and never observes a server context, so
 * the contextless router is the correct shape here, and it matches every tRPC
 * example. To add auth later, reintroduce `.context<Ctx>()` at this point AND
 * strip the context from the type the client sees.
 */
const t = initTRPC.create();

export const createTRPCRouter = t.router;
export const createCallerFactory = t.createCallerFactory;
export const baseProcedure = t.procedure;
