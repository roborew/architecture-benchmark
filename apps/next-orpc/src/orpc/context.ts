/**
 * The initial context every procedure receives.
 *
 * Deliberately empty, and this mirrors src/trpc/init.ts: the router is
 * contextless because nothing per-request is threaded through yet. A client
 * reaches the router over HTTP and never observes a server context, so there is
 * nothing honest to put here.
 *
 * To add auth later:
 *
 *   1. Add a field below.
 *   2. Build the initial context in src/app/rpc/[[...rest]]/route.ts and pass it
 *      to `handler.handle(request, { prefix, context })`. It accepts an async
 *      function, so `await headers()` works.
 *   3. Wire the same shape into the SSR client in src/orpc/server.tsx.
 *
 * Declaring it once here, rather than inlining `{}` at each use site, means the
 * handler, the client and any future middleware all name the same type.
 */
export type ORPCContext = Record<string, never>;

/**
 * `createContext` is a plain identity function in oRPC. Its value is that
 * `context` is then typed at every call site, so adding a field above
 * propagates errors to the handler and both clients instead of silently
 * becoming `any`.
 */
export const createORPCContext = (context: ORPCContext): ORPCContext => context;
