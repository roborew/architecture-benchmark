// tests/helpers/trpc-harness.tsx
//
// Renders a Client Component with a real tRPC provider whose link never touches
// the network.
//
// Before tRPC these components received a Server Action and mocked
// `@/lib/actions`. That no longer works: the component holds a TanStack Query
// mutation, so the mutation has to actually run for `isPending` and the
// `onSuccess` branch to behave. Terminating the link — rather than mocking
// `useTRPC` — keeps the real provider, the real options object, and the real
// mutation lifecycle, so the tests still exercise the component's own logic.

import type { QueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError, type TRPCLink, createTRPCClient } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

import { TRPCProvider } from "@/trpc/client";
import { makeQueryClient } from "@/trpc/query-client";
import type { AppRouter } from "@/trpc/routers/_app";

export type RecordedCall = { path: string; input: unknown };

/** The value a procedure resolves to, by path. May be async. */
export type Responder = (path: string, input: unknown) => unknown;

export type TrpcRenderResult = RenderResult & {
  /** Every procedure call the component made, in order. */
  calls: RecordedCall[];
};

/**
 * The shape the users procedures return on a refused write. A procedure hands
 * back `{ ok: false, ... }` rather than throwing, because a validation failure
 * is expected user error that the form renders.
 */
export function rejected(
  fields: Record<string, string[] | undefined>,
  message?: string,
) {
  return { ok: false as const, errors: fields, message };
}

export function accepted(id = 1) {
  return { ok: true as const, id };
}

/**
 * A terminating link: it never calls `next`, so the request stops here and the
 * responder supplies the result. Returning an observable is what the link
 * contract requires — the `{ type: "data" }` envelope is the shape the client
 * unwraps into the mutation's `data`.
 */
function terminatingLink(
  respond: Responder,
  calls: RecordedCall[],
): TRPCLink<AppRouter> {
  return () =>
    ({ op }) =>
      observable((observer) => {
        calls.push({ path: op.path, input: op.input });

        // Awaited so a test can hold the mutation in flight by returning a
        // promise it resolves later.
        void (async () => {
          try {
            const data = await respond(op.path, op.input);
            observer.next({ result: { type: "data", data } });
            observer.complete();
          } catch (error) {
            observer.error(
              new TRPCClientError(
                error instanceof Error ? error.message : String(error),
              ),
            );
          }
        })();
      });
}

export function renderWithTrpc(
  ui: ReactElement,
  respond: Responder = () => accepted(),
): TrpcRenderResult {
  const calls: RecordedCall[] = [];

  const trpcClient = createTRPCClient<AppRouter>({
    links: [terminatingLink(respond, calls)],
  });

  const queryClient: QueryClient = makeQueryClient();

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
          {children}
        </TRPCProvider>
      </QueryClientProvider>
    );
  }

  return Object.assign(render(ui, { wrapper: Wrapper }), { calls });
}
