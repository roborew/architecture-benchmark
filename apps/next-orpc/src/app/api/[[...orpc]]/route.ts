// The OpenAPI HTTP surface, alongside the RPC endpoint at /rpc.
//
// One router, two protocols. `RPCHandler` (src/app/rpc/[[...rest]]/route.ts)
// serves the RPC protocol that the app's own client speaks; this serves the same
// procedures as plain REST for anything else that wants to call them — a
// browser fetch, curl, Postman, or a generated client from the spec below.
//
// The paths come from the `openapi(...)` metadata already on each contract entry
// in src/orpc/contract.ts, so there is nothing to declare here. That metadata is
// also what makes the two protocols agree: the RPC path is derived from the
// router shape, and this one is declared.
//
// Try it:
//   curl localhost:3000/api/users
//   curl localhost:3000/api/tasks/1
//   curl localhost:3000/api/spec.json      <- the OpenAPI document
//   open localhost:3000/api                 <- Scalar UI for the above

import { SmartCoercionHandlerPlugin } from "@orpc/json-schema";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIGenerator } from "@orpc/openapi";
import { OpenAPIReferenceHandlerPlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { ZodToJsonSchemaConverter } from "@orpc/zod";

import { router } from "@/orpc/routers/_app";

// The document is generated once, lazily, and cached by the closure below. The
// router is static, so regenerating per request would be wasted work.
const generator = new OpenAPIGenerator({
  converters: [new ZodToJsonSchemaConverter()],
});

const handler = new OpenAPIHandler(router, {
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
  plugins: [
    /**
     * Query and path values arrive as STRINGS, because that is what a URL can
     * carry. Without this, `GET /users/1` would fail validation: the contract says
     * `id: z.number().int()` and the handler is handed `"1"`.
     *
     * The plugin coerces only lossless, schema-driven conversions and leaves
     * anything ambiguous untouched, so it cannot quietly change a value's
     * meaning. It is not needed for POST bodies, which are real JSON — but it is
     * harmless there and one plugin is simpler than two code paths.
     */
    new SmartCoercionHandlerPlugin({
      converters: [new ZodToJsonSchemaConverter()],
    }),

    /**
     * Serves the OpenAPI document at /api/spec.json and the Scalar UI at /api.
     *
     * The docs path is NOT /api/docs: `docsPath` defaults to "/", so the UI is
     * served at the handler prefix root. Pass `docsPath: "/docs"` to move it if
     * the bare prefix is inconvenient. (Requesting /api directly 308-redirects
     * to /api/, which then returns the UI.)
     */
    new OpenAPIReferenceHandlerPlugin({
      spec: () =>
        generator.generate(router, {
          base: {
            info: {
              title: "Tasks Manager API",
              version: "0.1.0",
              description:
                "Generated from the oRPC contracts in src/orpc/contract.ts. The same procedures are also served over the RPC protocol at /rpc.",
            },
            // Relative, so the document is correct on whatever host it is served
            // from. Set an absolute URL for a deployed, externally consumed API.
            servers: [{ url: "/api" }],
          },
        }),
    }),
  ],
});

async function handleRequest(request: Request) {
  const { matched, response } = await handler.handle(request, {
    prefix: "/api",
    // Empty, see src/orpc/context.ts. Accepts an async function, so this is
    // where `await headers()` would go when auth arrives.
    context: {},
  });

  // `matched` is false when no procedure matched the path — including for the
  // docs paths when the reference plugin is not mounted. The 404 is ours.
  return matched ? response : new Response("Not found", { status: 404 });
}

export {
  handleRequest as GET,
  handleRequest as POST,
  handleRequest as PUT,
  handleRequest as PATCH,
  handleRequest as DELETE,
  handleRequest as HEAD,
};
