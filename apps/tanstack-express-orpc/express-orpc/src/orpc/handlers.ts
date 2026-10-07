// src/orpc/handlers.ts
//
// The two HTTP surfaces one router serves, built once per app.
//
//   RPCHandler      /rpc — the oRPC RPC protocol the SPA's client speaks
//                   (RPCLink). One round-trip per procedure call, inputs and
//                   outputs as JSON, errors as oRPC's error channel.
//
//   OpenAPIHandler  /api — the same procedures as plain REST for anything
//                   else that wants to call them: a browser fetch, curl,
//                   Postman, or a generated client from the spec. The paths
//                   come from the `openapi(...)` metadata on each contract
//                   entry in src/orpc/contract.ts, which mirrors the REST
//                   surface this app served before the migration, so an
//                   external caller sees the same API it always did.
//
// Try it:
//   curl localhost:4000/api/users
//   curl localhost:4000/api/tasks/1
//   curl localhost:4000/api/spec.json      <- the OpenAPI document
//   open localhost:4000/api               <- Scalar UI for the above
//
// Both are Node-HTTP handlers (`handle(req, res, { prefix })`), which is what
// makes the Express mount in src/app.ts a three-line adapter: Express's
// req/res ARE Node's, so no Request/response conversion is needed.

import { SmartCoercionHandlerPlugin } from "@orpc/json-schema";
import { OpenAPIGenerator } from "@orpc/openapi";
import { OpenAPIHandler } from "@orpc/openapi/node";
import { OpenAPIReferenceHandlerPlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/node";
import { ZodToJsonSchemaConverter } from "@orpc/zod";

import type { AppRouter } from "./routers/_app.ts";
import { contract } from "./routers/_app.ts";

export function createHandlers(router: AppRouter) {
  const rpcHandler = new RPCHandler(router, {
    // Server-side log of anything that escapes a handler. The models already
    // log their own database faults, so this is the net for genuine bugs.
    interceptors: [onError((error) => console.error(error))],
  });

  // The document is generated once, lazily, and cached by the plugin's
  // `spec()` callback. The router is static, so regenerating per request would
  // be wasted work.
  const generator = new OpenAPIGenerator({
    converters: [new ZodToJsonSchemaConverter()],
  });

  const openAPIHandler = new OpenAPIHandler(router, {
    interceptors: [onError((error) => console.error(error))],
    plugins: [
      /**
       * Query and path values arrive as STRINGS, because that is what a URL
       * can carry. Without this, `GET /users/1` would fail validation: the
       * contract says `id: z.number().int()` and the handler is handed `"1"`.
       *
       * The plugin coerces only lossless, schema-driven conversions and
       * leaves anything ambiguous untouched, so it cannot quietly change a
       * value's meaning. It is not needed for bodies, which are real JSON —
       * but it is harmless there and one plugin is simpler than two code
       * paths.
       */
      new SmartCoercionHandlerPlugin({
        converters: [new ZodToJsonSchemaConverter()],
      }),

      /**
       * Serves the OpenAPI document at /api/spec.json and the Scalar UI at
       * /api.
       */
      new OpenAPIReferenceHandlerPlugin({
        spec: () =>
          generator.generate(contract, {
            base: {
              info: {
                title: "Tasks Manager API",
                version: "0.1.0",
                description:
                  "Generated from the oRPC contracts in src/orpc/contract.ts. The same procedures are served over the RPC protocol at /rpc.",
              },
              // Relative, so the document is correct on whatever host it is
              // served from. Set an absolute URL for a deployed, externally
              // consumed API.
              servers: [{ url: "/api" }],
            },
          }),
      }),
    ],
  });

  return { rpcHandler, openAPIHandler };
}

export type Handlers = ReturnType<typeof createHandlers>;
