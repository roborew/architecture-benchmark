// tests/e2e/hydration.ts
//
// A wait for the client bundle to finish loading and running.
//
// TanStack Start streams server-rendered HTML first and hydrates on the client,
// so a control present in the document is not yet interactive the moment
// Playwright's `goto` resolves. Under Next.js this never surfaced: Server
// Actions are attached at hydration too, but the Next dev build hydrated fast
// enough that the suite's first action always landed afterwards.
//
// These specs act immediately after `goto` — selecting a page size, typing a
// filter — and an action landing before hydration is *silently dropped* rather
// than failing loudly. The symptom was a list that never re-rendered and a
// "Next" button stuck disabled for reasons unrelated to the code.
//
// Why `networkidle` rather than a structural check: `document.readyState`, the
// presence of the client entry <script>, and router internals were all tried and
// none of them are reliable. The entry script stays in the DOM after it has run,
// so its presence says nothing about whether React has attached its listeners;
// `readyState` fires before the module graph is even fetched. The dev bundle is
// fetched and evaluated only after the document settles, so an idle network is
// the closest observable point before hydration.
//
// The one alternative — polling for a React event handler — is not expressible
// from the page. A listener added to a node proves that node's own listeners
// work, which is true whether or not React has hydrated, so it cannot
// distinguish the two cases. Firing a real event at an application input does
// distinguish them, but it also runs that input's handler, which navigates and
// corrupts the test; that was tried and reverted.

import type { Page } from "@playwright/test";

/**
 * Navigates and waits until the client bundle has loaded.
 *
 * `networkidle` is a heuristic, and a deliberately coarse one. It is chosen over
 * a fixed sleep because the alternative is a test that passes on a fast machine
 * and fails on a slow one; a sleep tuned to the observed ~500ms would do the
 * latter.
 */
export async function goto(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: "networkidle" });
}
