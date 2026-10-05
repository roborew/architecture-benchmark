import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { appRouter } from "@/trpc/routers/_app";

// The fetch adapter, not the Next adapter: App Router route handlers are
// Web-standard Request/Response. GET is required for httpBatchLink to batch
// queries over a single request.
const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
  });

export { handler as GET, handler as POST };
