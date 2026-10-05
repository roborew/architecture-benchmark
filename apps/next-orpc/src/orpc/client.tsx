"use client";

// ^-- so the Provider can be mounted from the server component root layout

// The browser/SSR client. Compare src/trpc/client.tsx.
//
// The differences are mostly mechanical, and each one is a v2 API change rather
// than a design change:
//
//   * `createTRPCContext<AppRouter>()` / `useTRPC()` are gone. oRPC needs no
//     provider hook: `orpc` below is a plain object of option builders, so
//     components call `orpc.users.list.queryOptions(...)` instead of
//     `useTRPC().users.list.queryOptions(...)`.
//   * `RPCLink` splits the endpoint into `origin` + `url`. The v1 single `url`
//     form is gone; `url` is now a path prefix and MUST match the route
//     handler's prefix below.
//   * `httpBatchLink` becomes `BatchLinkPlugin`. See the batching note further
//     down before re-enabling it.
//
// Because there is no provider hook, this module's job is narrower than the tRPC
// one's: build the client, expose the option builders, and mount the TanStack
// Query provider the app already had.

import type { QueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import type { RouterClient } from "@orpc/server";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";

import { makeQueryClient } from "./query-client";
import type { AppRouter } from "./routers/_app";

let browserQueryClient: QueryClient;

function getQueryClient() {
  // Server: always a new query client.
  if (typeof window === "undefined") return makeQueryClient();
  // Browser: reuse the one client. This is important, so we do not re-make a new
  // client if React suspends during the initial render.
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}

function getUrl() {
  // v2: `url` is a path prefix, and the origin is a separate option. In the
  // browser `origin: undefined` means "the page's own origin", so there is no
  // browser branch to write.
  const origin =
    typeof window !== "undefined"
      ? undefined
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000";

  return origin;
}

const link = new RPCLink({
  origin: getUrl(),
  // Must match the `prefix` passed to handler.handle() in the route handler.
  url: "/rpc",
  // No method override, so every call is a POST. That is deliberate: v2 rejects
  // GET by default (`allowMethods` defaults to POST/PUT/PATCH/DELETE), and the
  // migration guide's recommendation is to stop sending GET rather than re-enable
  // it and add CSRF protection. Verified: a GET yields no handler response at
  // all, so the route's 404 fallback answers it. If GET is ever genuinely needed,
  // allow it on the handler and add GetMethodCsrfProtectionHandlerPlugin there.
});

/**
 * The client the components call.
 *
 * On the server this makes real HTTP requests back into this same app. That is
 * wasteful and is fixed in src/orpc/server.tsx for server components; this
 * module is for the browser, where there is no in-process shortcut.
 */
/**
 * `createORPCClient` is generic over the CLIENT shape, not the router — its
 * parameter is constrained to `AnyNestedClient`. So this needs
 * `RouterClient<AppRouter>`; handing it `AppRouter` directly fails to satisfy
 * that constraint, because a router is built from `Procedure` builders and a
 * client is built from procedure *callables*.
 */
export const client: RouterClient<AppRouter> = createORPCClient(link);

/**
 * The option builders.
 *
 *   useQuery(orpc.users.list.queryOptions({ input: { search: "" } }))
 *   useMutation(orpc.users.create.mutationOptions())
 *
 * Note the shape difference from tRPC: input lives under an `input` key rather
 * than being passed positionally, and the key builders (`.key()`, `.queryKey()`)
 * are how you invalidate, not `trpc.users.list.path`.
 */
export const orpc = createTanstackQueryUtils(client);

// Batching note: the tRPC setup used `httpBatchLink`, which batched queries over
// one GET request. The v2 equivalent is:
//
//   import { BatchLinkPlugin } from "@orpc/client/plugins";
//   new RPCLink({ url: "/rpc", plugins: [new BatchLinkPlugin()] })
//
// It is left off deliberately. BatchLinkPlugin sends a GET, which v2 rejects by
// default, and the comments router's single `create` is the only write this app
// would plausibly batch. Turn it on together with `allowMethods` on the handler
// and the CSRF plugin, not on its own.

/**
 * The provider the root layout mounts.
 *
 * There is no oRPC counterpart to `<TRPCProvider trpcClient={...}>`: the client
 * above is a module-level singleton, so mounting it per render was never needed.
 * What remains is the TanStack Query provider, which the app already depends on.
 */
export function ORPCProvider({ children }: { children: React.ReactNode }) {
  // NOTE: avoid useState for the query client — without a Suspense boundary
  // above it, React discards a state-held client on the initial render.
  const queryClient = getQueryClient();

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
