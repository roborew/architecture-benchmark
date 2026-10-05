// The oRPC endpoint. Serves the whole router, so it is a catch-all segment.
//
// The counterpart to src/app/api/trpc/[trpc]/route.ts. Note the path moved from
// /api/trpc to /rpc, which is where oRPC's own examples put it; the client's
// `url: "/rpc"` in src/orpc/client.tsx must match the `prefix` below exactly, and
// moving either one without the other is the failure mode here.
//
// The catch-all `[[...rest]]` (optional) rather than `[rest]` is deliberate: it
// also matches the bare /rpc path.

import { router } from "@/orpc/routers/_app";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";

const handler = new RPCHandler(router, {
  interceptors: [
    // Server-side log of anything that escapes a handler. data.ts already logs
    // its own database faults, so this is the net for genuine bugs.
    onError((error) => {
      console.error(error);
    }),
  ],
});

async function handleRequest(request: Request) {
  // `context` is the initial context. It is empty, see src/orpc/context.ts — and
  // it accepts an async function, so this is where `await headers()` would go
  // when auth arrives.
  const { response } = await handler.handle(request, {
    prefix: "/rpc",
    context: {},
  });

  // `response` is undefined when no procedure matched the path, so the 404 is
  // ours to return. This is the one behaviour with no tRPC analogue worth noting:
  // tRPC's fetch adapter produced the 404 itself.
  return response ?? new Response("Not found", { status: 404 });
}

// All methods are exported even though v2 rejects GET by default. PUT/PATCH are
// listed so the router can grow an update-without-id procedure without revisiting
// this file.
//
// GET is exported for parity with the tRPC route, but note what it actually does:
// v2's `allowMethods` defaults to POST/PUT/PATCH/DELETE, so a GET produces NO
// response from the handler and falls through to the 404 below — not a 405. That
// is verified behaviour, not a guess. Re-enabling GET means extending
// `allowMethods` AND adding GetMethodCsrfProtectionHandlerPlugin here; see the
// note in src/orpc/client.tsx.
export {
  handleRequest as HEAD,
  handleRequest as GET,
  handleRequest as POST,
  handleRequest as PUT,
  handleRequest as PATCH,
  handleRequest as DELETE,
};
