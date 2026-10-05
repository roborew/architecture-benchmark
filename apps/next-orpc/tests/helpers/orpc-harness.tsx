// tests/helpers/orpc-harness.tsx
//
// Renders a Client Component against an oRPC client whose link never touches the
// network. This is the oRPC counterpart to trpc-harness.tsx.
//
// Why a harness at all, and why not just `vi.mock` the components:
//
// UserForm and DeleteUserButton hold TanStack Query mutations, so the mutation
// has to actually run for `isPending` and the `onSuccess` branch to behave.
// Terminating the LINK — rather than replacing the `orpc` object with a stub —
// keeps the real client, the real `createTanstackQueryUtils` option builders and
// the real mutation lifecycle in play, so these tests still exercise the
// component's own logic rather than a hand-rolled imitation of it.
//
// oRPC makes this easier than tRPC did. `ClientLink` is a single `call` method,
// so a terminating link is one object with one function — no observable ceremony.
//
// THE TEST FILE MUST DECLARE THE MOCK ITSELF. This is the one sharp edge:
//
//     vi.mock("@/orpc/client", () => orpcMock());
//
// A `vi.mock` inside this helper would not work. In a test file that imports
// both "@/orpc/client" and this helper, the component module is evaluated first,
// so a mock registered here would land after the real client had already been
// captured — and the tests would silently exercise a real RPCLink and fail on
// "Failed to parse URL from /rpc/...". Keeping the `vi.mock` call in the test
// file makes the registration order explicit and correct.
//
// That is why the factory below reads from globalThis rather than closing over a
// module-level variable: a hoisted factory cannot reference this module's
// bindings, but it can read a global.

import type { RouterClient } from "@orpc/server";
import { createORPCClient } from "@orpc/client";
import type { QueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

import { makeQueryClient } from "@/orpc/query-client";
import type { AppRouter } from "@/orpc/routers/_app";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";

export type RecordedCall = { path: string; input: unknown };

/** The value a procedure resolves to, by path. May be async. */
export type Responder = (path: string, input: unknown) => unknown;

export type OrpcRenderResult = RenderResult & {
  /** Every procedure call the component made, in order. */
  calls: RecordedCall[];
};

export type OrpcUtils = ReturnType<
  typeof createTanstackQueryUtils<RouterClient<AppRouter>>
>;

/**
 * The shape the users procedures return on a refused write. A procedure hands
 * back `{ ok: false, ... }` rather than throwing, because a validation failure
 * is expected user error that the form renders — see src/lib/result.ts.
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
 * The factory a test file passes to `vi.mock`:
 *
 *   vi.mock("@/orpc/client", () => orpcMock());
 *
 * It returns a module whose `orpc` is resolved lazily, on every read, from the
 * slot `renderWithOrpc` fills. A getter rather than a value because the factory
 * runs during import — before any render has happened.
 */
export function orpcMock() {
  return {
    get orpc(): OrpcUtils {
      const utils = (globalThis as { __orpcTestUtils?: OrpcUtils })
        .__orpcTestUtils;

      if (!utils) {
        throw new Error(
          "orpc was read before renderWithOrpc ran. Render through the harness so the client is terminated.",
        );
      }

      return utils;
    },
  };
}

/**
 * A terminating link. `call` IS the transport: the client invokes it, and what
 * it returns becomes the procedure's resolved value. Nothing is serialized and
 * nothing is sent, so the responder's object arrives as-is — which is what lets
 * `rejected()` return a plain `{ ok: false }` and have it reach `onSuccess`
 * unaltered.
 *
 * Recording happens before the responder is awaited, so a call is captured even
 * while its response is still pending.
 */
function terminatingLink(respond: Responder, calls: RecordedCall[]) {
  return {
    async call(path: string[], input: unknown) {
      calls.push({ path: path.join("."), input });

      // Awaited so a test can hold the mutation in flight by returning a
      // promise it resolves later.
      return await respond(path.join("."), input);
    },
  };
}

/**
 * Builds `orpc` utils backed by a terminating link, without rendering anything.
 *
 * Useful when a test needs the utils directly, e.g. to pass into a probe that
 * is not itself mocked.
 */
export function makeOrpcUtils(respond: Responder): {
  orpc: OrpcUtils;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const client: RouterClient<AppRouter> = createORPCClient(
    terminatingLink(respond, calls),
  );

  return { orpc: createTanstackQueryUtils(client), calls };
}

/**
 * Renders `ui` with a QueryClientProvider and a terminated `orpc` client.
 *
 * Only a QueryClientProvider is mounted: oRPC has no provider of its own, so
 * there is nothing else to wrap with. That is a genuine simplification over
 * trpc-harness.tsx, which had to mount a TRPCProvider as well.
 *
 * Requires `vi.mock("@/orpc/client", () => orpcMock())` in the calling test
 * file — see the note at the top of this file.
 */
export function renderWithOrpc(
  ui: ReactElement,
  respond: Responder = () => accepted(),
): OrpcRenderResult {
  const { orpc, calls } = makeOrpcUtils(respond);

  // Set before render, so the component reads this instance.
  (globalThis as { __orpcTestUtils?: OrpcUtils }).__orpcTestUtils = orpc;

  const queryClient: QueryClient = makeQueryClient();

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  return Object.assign(render(ui, { wrapper: Wrapper }), { calls });
}
