// tests/helpers/render.tsx
//
// A `render` that provides the router context every TanStack component needs.
//
// Solid equivalent of the React test helper. Uses solid-testing-library
// and wraps components in RouterContextProvider from @tanstack/solid-router.

import { render } from "solid-testing-library";
import {
  RouterContextProvider,
  createMemoryHistory,
} from "@tanstack/solid-router";
import { createRoot, type JSX } from "solid-js";

import { getRouter } from "@/router";

// Solid doesn't need React's act batching, but tests use it to wrap async
// operations. Provide a compatible shim that awaits the callback.
export async function act(fn: () => Promise<void> | void): Promise<void> {
  await fn();
  // Yield multiple times through the microtask queue to let Solid's reactive
  // system process all pending effects. Solid may schedule effects across
  // multiple ticks, especially when signals are updated from timers.
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => queueMicrotask(resolve));
  }
}

/**
 * Builds a router over a memory history, so no test needs a dev server.
 *
 * The router must be created inside a Solid reactive root so its internal
 * stores (which use createSignal) are properly initialized. Without this,
 * RouterContextProvider will throw "Cannot read properties of null (reading 'stores')".
 */
export function makeTestRouter(initialEntry = "/") {
  const history = createMemoryHistory({ initialEntries: [initialEntry] });
  let router: ReturnType<typeof getRouter> | undefined;

  // Create the router inside a reactive root so Solid signals can be created
  createRoot(() => {
    router = getRouter({ history });
    // Keep the root alive for the lifetime of the test
    // It will be cleaned up when the process exits
  });

  if (!router) {
    throw new Error("Failed to create router in reactive root");
  }

  return router;
}

interface RenderOptions {
  route?: string;
}

export function renderWithRouter(
  ui: () => JSX.Element,
  { route = "/" }: RenderOptions = {},
) {
  const router = makeTestRouter(route);

  function Wrapper(props: { children: JSX.Element }) {
    return (
      <RouterContextProvider router={router}>
        {() => props.children}
      </RouterContextProvider>
    );
  }

  return render(() => <Wrapper>{ui()}</Wrapper>);
}

// Everything else comes straight from Testing Library.
export * from "solid-testing-library";
