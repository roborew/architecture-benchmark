// tests/helpers/render.tsx
//
// A `render` that provides the router context every TanStack component needs.
//
// This is the one piece of test infrastructure the port genuinely adds. Under
// Next.js, `next/link` and `useRouter` work in a bare jsdom render with no
// setup at all — a component test was just `render(<ProjectList ... />)`.
// TanStack's `Link` reads the router out of React context (in `useLinkProps`)
// and `useRouter`/`useLocation` read it directly, so rendering one of these
// components without a provider throws "Cannot read properties of null".
//
// Rather than have each test file build its own provider, the wrapper lives
// here. `route` sets the URL so the router-dependent tests (the active nav
// item, the search field's value, the applied filters) can set up the state
// they are asserting about.

import {
  render,
  type RenderOptions,
  type RenderResult,
} from "@testing-library/react";
import {
  RouterContextProvider,
  createMemoryHistory,
} from "@tanstack/react-router";
import type { ReactElement, ReactNode } from "react";

import { getRouter } from "@/router";

/**
 * Builds a router over a memory history, so no test needs a dev server.
 *
 * A fresh router per call: the route tree caches loader data per match, and
 * sharing one router across tests would let a cached loader answer a test that
 * expects a cold read.
 */
export function makeTestRouter(initialEntry = "/") {
  const history = createMemoryHistory({ initialEntries: [initialEntry] });

  return getRouter({ history });
}

type Options = Omit<RenderOptions, "wrapper"> & {
  /** The URL the router should start at. */
  route?: string;
};

export function renderWithRouter(
  ui: ReactElement,
  { route = "/", ...options }: Options = {},
): RenderResult {
  const router = makeTestRouter(route);

  function Wrapper({ children }: { children: ReactNode }) {
    // RouterContextProvider, not RouterProvider. The latter renders the
    // current *route match* and ignores its children, so it would replace the
    // component under test with the route tree's own output and the test would
    // be asserting against the wrong tree entirely.
    return (
      <RouterContextProvider router={router}>{children}</RouterContextProvider>
    );
  }

  return render(ui, { wrapper: Wrapper, ...options });
}

// Everything else (screen, within, fireEvent, act, waitFor, …) comes straight
// from Testing Library, so a test file's import list stays the same as it was
// under Next.js apart from `render`.
export * from "@testing-library/react";
