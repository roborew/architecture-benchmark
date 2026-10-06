// tests/e2e/wait-for-route-data.ts
//
// Waiting for a client-side navigation to finish loading its data.
//
// A necessary companion to navigating, and a different wait from the one in
// ./hydration.ts. On a *client-side* navigation TanStack updates the URL first
// and re-runs the route loader afterwards, so an assertion on the URL can pass
// while the page still shows the previous route's rows. Reading content straight
// after a URL assertion therefore reads stale data — which showed up here as
// the second page of tasks appearing to repeat the first.
//
// Under Next.js this could not happen: a Server Action redirect is a real
// document navigation, so the new HTML arrived together with the new URL and
// there was never an interval in which the two disagreed.
//
// Why the rendered text is polled rather than a router flag: every router-level
// signal was tried, and none of them describes this window.
//
//   router.state.status     stays "pending" after a client navigation that has
//                           in fact finished — it tracks location resolution,
//                           not the running loader.
//   router.state.isLoading  goes true on the first navigation and never returns
//                           to false.
//   match.status            stays "success" throughout, because the route
//                           already has data; re-running its loader is not a new
//                           match.
//
// The wait is therefore "the main region changed, and has stopped changing".
// Comparing against the snapshot taken *before* the navigation is what
// separates "settled on new data" from "still showing the old data"; requiring
// two consecutive identical reads afterwards is what separates "settled" from
// "mid-render".

import { expect, type Page } from "@playwright/test";

const TIMEOUT = 15_000;

async function readMain(page: Page): Promise<string> {
  return page
    .getByRole("main")
    .innerText()
    .catch(() => "");
}

/**
 * Waits until the main region differs from `previous` and has stopped changing.
 *
 * Pass the text captured before the navigation; omitting it waits only for the
 * region to settle, which cannot distinguish a stale render from a fresh one.
 */
export async function waitForRouteData(
  page: Page,
  previous: string,
): Promise<void> {
  // Poll for *stability of new content* rather than for the first difference.
  //
  // Waiting for "differs from before" is not enough: the previous route's rows
  // are still on screen at that instant, so the wait returns while the page
  // shows the old data. What is wanted is a snapshot that both differs from
  // `previous` and does not change on the next read — i.e. the render
  // happened and finished.
  let candidate: string | null = null;

  await expect
    .poll(
      async () => {
        const current = await readMain(page);

        if (current.length === 0) return "empty";

        // Once a differing snapshot is seen, hold it and require the next read
        // to agree before declaring the render finished.
        if (candidate !== null && current === candidate) return "settled";

        if (current === previous) {
          // No change yet; drop any earlier candidate, it was superseded.
          candidate = null;
          return "stale";
        }

        candidate = current;
        return "changing";
      },
      { timeout: TIMEOUT, intervals: [80, 120, 180, 250, 400] },
    )
    .toBe("settled");
}

/**
 * Performs a navigation and waits for the resulting render to settle.
 *
 * This is the form the specs want: capture what is on screen, act, then wait
 * for the screen to be stable.
 *
 * Note this waits for *stability*, not for *change*. Some navigations render
 * exactly the same text — changing the page size while a filter is applied can
 * leave the same rows on screen while the URL changes — and demanding a change
 * would time out on those. The URL is asserted separately by the caller, so
 * stability plus a URL assertion is the complete check.
 */
export async function afterNavigation(
  page: Page,
  // The action's return value is ignored; the parameter is widened to `unknown`
  // so a spec can pass a Playwright call directly without discarding its result
  // in a wrapper arrow.
  action: () => Promise<unknown>,
  options: { expectChange?: boolean } = {},
): Promise<void> {
  const before = options.expectChange ? await readMain(page) : undefined;

  await action();

  if (before === undefined) {
    await waitForSettled(page);
  } else {
    await waitForRouteData(page, before);
  }
}

/**
 * Waits until the main region stops changing.
 *
 * Two consecutive identical reads mean the render has finished. This cannot tell
 * "settled on new data" from "settled on stale data" — pair it with a URL
 * assertion, or use `waitForRouteData` with a known `previous` snapshot when
 * the distinction matters.
 */
export async function waitForSettled(page: Page): Promise<void> {
  let previous = await readMain(page);

  await expect
    .poll(
      async () => {
        const current = await readMain(page);
        const settled = current.length > 0 && current === previous;
        previous = current;

        return settled;
      },
      { timeout: TIMEOUT, intervals: [80, 120, 180, 250, 400] },
    )
    .toBe(true);
}
