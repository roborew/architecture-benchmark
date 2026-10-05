"use client";

// ^-- so the Provider can be mounted from the server component root layout

import type { QueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import { useState } from "react";

import { makeQueryClient } from "./query-client";
import type { AppRouter } from "./routers/_app";

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

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
  const base =
    typeof window !== "undefined"
      ? ""
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000";
  return `${base}/api/trpc`;
}

export function TRPCReactProvider({ children }: { children: React.ReactNode }) {
  // NOTE: avoid useState for the query client — without a Suspense boundary
  // above it, React discards a state-held client on the initial render.
  const queryClient = getQueryClient();

  const [trpcClient] = useState(() =>
    createTRPCClient<AppRouter>({
      // No transformer: src/lib/types.ts already stringifies timestamps, so
      // plain JSON round-trips every value. See trpc/init.ts.
      links: [httpBatchLink({ url: getUrl() })],
    }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        {children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}
