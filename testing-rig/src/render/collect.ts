// Render-speed collector (plan §6.4). Measured separately from the correctness
// suite: it drives a fixed, pinned Chromium at a fixed viewport, discarding
// warmup samples, and records raw per-sample rows. It asserts nothing — a render
// figure is a measurement (always labelled *indicative single-host*), not a gate.
//
// Cold browser context per sample (context ≠ cold app — the app stays warm). Two
// metric families:
//   * navigation, on data-bearing pages: TTFB, FCP, LCP (PerformanceObserver)
//     and first-useful-data (the moment the page's first data element is visible).
//   * interaction, click-to-visible-committed: create/update/delete/
//     create-with-comment, timed until the persisted result is visible.
//
// Env: BENCH_BASE_URL, BENCH_VARIANT, BENCH_WARMUP, BENCH_MEASURED,
// BENCH_RENDER_REPORT (output JSON path).

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  chromium,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";

const baseUrl = required("BENCH_BASE_URL");
const variant = process.env.BENCH_VARIANT ?? "unknown";
const warmup = Number(process.env.BENCH_WARMUP ?? 5);
const measured = Number(process.env.BENCH_MEASURED ?? 10);
const reportPath = required("BENCH_RENDER_REPORT");
const VIEWPORT = { width: 1365, height: 768 };

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

interface NavSample {
  ttfb: number;
  fcp: number;
  lcp: number;
  firstData: number;
}

const PAGES = [
  {
    name: "projects",
    path: "/projects",
    ready: '[data-testid="project-link"]',
  },
  { name: "board", path: "/projects/1", ready: '[data-testid="task-row"]' },
  { name: "detail", path: "/tasks/1", ready: '[data-testid="task-detail"]' },
] as const;

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  // Install the LCP observer before any navigation so the entry is captured.
  await page.addInitScript(() => {
    (window as unknown as { __lcp?: number }).__lcp = 0;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          (window as unknown as { __lcp?: number }).__lcp = entry.startTime;
        }
      }).observe({ type: "largest-contentful-paint", buffered: true });
    } catch {
      // Older engines: leave __lcp at 0.
    }
  });
  return page;
}

async function navSample(
  browser: Browser,
  path: string,
  ready: string,
): Promise<NavSample> {
  const page = await newPage(browser);
  try {
    await page.goto(`${baseUrl}${path}`, { waitUntil: "commit" });
    await page
      .locator(ready)
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
    return await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] as
        PerformanceNavigationTiming | undefined;
      const fcp = performance.getEntriesByName("first-contentful-paint")[0];
      return {
        ttfb: nav ? nav.responseStart : 0,
        fcp: fcp ? fcp.startTime : -1,
        lcp: (window as unknown as { __lcp?: number }).__lcp ?? -1,
        // Time since navigation start at the moment the data element is visible.
        firstData: performance.now(),
      };
    });
  } finally {
    await page.context().close();
  }
}

/** Wall-clock click → committed-visible (spans navigation, so Date.now). */
async function interaction(
  browser: Browser,
  run: (page: Page) => Promise<void>,
): Promise<number> {
  const page = await newPage(browser);
  try {
    const startedAt = Date.now();
    await run(page);
    return Date.now() - startedAt;
  } finally {
    await page.context().close();
  }
}

async function chooseFirstOption(select: Locator): Promise<void> {
  if (!(await select.count())) return;
  if (await select.inputValue().catch(() => "")) return;
  const values = await select
    .locator("option")
    .evaluateAll((options) =>
      options.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
    );
  if (values[0]) await select.selectOption(values[0]);
}

async function fillCreateForm(
  page: Page,
  testid: string,
  title: string,
): Promise<void> {
  const form = page.getByTestId(testid);
  await form.waitFor({ state: "visible" });
  await form.locator('[name="title"]').fill(title);
  await chooseFirstOption(form.locator('[name="projectId"]'));
}

async function createInteraction(browser: Browser): Promise<number> {
  const title = `render-create-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  return interaction(browser, async (page) => {
    await page.goto(`${baseUrl}/tasks/new`, { waitUntil: "commit" });
    await fillCreateForm(page, "create-task-form", title);
    await page
      .getByTestId("create-task-form")
      .locator('button[type="submit"]')
      .first()
      .click();
    await page
      .getByTestId("task-title")
      .filter({ hasText: title })
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
  });
}

async function updateInteraction(browser: Browser): Promise<number> {
  const title = `render-update-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  return interaction(browser, async (page) => {
    await page.goto(`${baseUrl}/projects/1`, { waitUntil: "commit" });
    await page
      .getByTestId("task-row")
      .first()
      .getByTestId("task-title")
      .click();
    await page.waitForURL(/\/tasks\/\d+/);
    const id = page.url().match(/\/tasks\/(\d+)/)![1]!;
    await page.goto(`${baseUrl}/tasks/${id}/edit`, { waitUntil: "commit" });
    const form = page.getByTestId("update-task-form");
    await form.waitFor({ state: "visible" });
    await form.locator('[name="title"]').fill(title);
    await form.locator('button[type="submit"]').first().click();
    await page
      .waitForURL((url) => !url.pathname.endsWith("/edit"), { timeout: 20_000 })
      .catch(() => {});
    await page
      .getByTestId("task-title")
      .filter({ hasText: title })
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
  });
}

async function deleteInteraction(browser: Browser): Promise<number> {
  return interaction(browser, async (page) => {
    await page.goto(`${baseUrl}/projects/1`, { waitUntil: "commit" });
    await page
      .getByTestId("task-row")
      .first()
      .getByTestId("task-title")
      .click();
    await page.waitForURL(/\/tasks\/\d+/);
    const id = page.url().match(/\/tasks\/(\d+)/)![1]!;
    await page.getByTestId("delete-task-button").first().click();
    await page.waitForURL((url) => !url.pathname.endsWith(`/tasks/${id}`), {
      timeout: 30_000,
    });
  });
}

async function createWithCommentInteraction(browser: Browser): Promise<number> {
  const title = `render-atomic-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  return interaction(browser, async (page) => {
    await page.goto(`${baseUrl}/tasks/new`, { waitUntil: "commit" });
    const form = page.getByTestId("create-with-comment-form");
    await form.waitFor({ state: "visible" });
    await form.locator('[name="title"]').fill(title);
    await form.locator('[name="commentBody"]').fill("render timing comment");
    await chooseFirstOption(form.locator('[name="projectId"]'));
    await chooseFirstOption(form.locator('[name="commentAuthorId"]'));
    await form.locator('button[type="submit"]').first().click();
    // Wait for the atomic action to redirect before navigating away.
    await page
      .waitForURL((url) => !url.pathname.endsWith("/tasks/new"), {
        timeout: 20_000,
      })
      .catch(() => {});
    await page.goto(`${baseUrl}/tasks`, { waitUntil: "commit" });
    const row = page.getByTestId("task-row").filter({ hasText: title }).first();
    await row.waitFor({ state: "visible", timeout: 30_000 });
    await row.getByTestId("task-title").click();
    await page
      .getByTestId("comment-row")
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
  });
}

const INTERACTIONS: Record<string, (browser: Browser) => Promise<number>> = {
  create: createInteraction,
  update: updateInteraction,
  delete: deleteInteraction,
  "create-with-comment": createWithCommentInteraction,
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

async function collectSeries<T>(
  browser: Browser,
  factory: () => Promise<T>,
): Promise<T[]> {
  for (let i = 0; i < warmup; i += 1) await factory();
  const samples: T[] = [];
  for (let i = 0; i < measured; i += 1) samples.push(await factory());
  return samples;
}

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const chromiumVersion = browser.version();
  const pages: Record<string, NavSample[]> = {};
  const interactions: Record<string, number[]> = {};
  const errors: Record<string, string> = {};
  try {
    for (const definition of PAGES) {
      try {
        pages[definition.name] = await collectSeries(browser, () =>
          navSample(browser, definition.path, definition.ready),
        );
      } catch (error) {
        errors[`nav:${definition.name}`] =
          error instanceof Error ? error.message : String(error);
      }
    }
    for (const [name, run] of Object.entries(INTERACTIONS)) {
      try {
        interactions[name] = await collectSeries(browser, () => run(browser));
      } catch (error) {
        errors[`op:${name}`] =
          error instanceof Error ? error.message : String(error);
      }
    }
  } finally {
    await browser.close();
  }

  const report = {
    variant,
    baseUrl,
    config: { warmup, measured, viewport: VIEWPORT, chromium: chromiumVersion },
    pages,
    interactions,
    errors,
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const boardTtfb = pages.board ? median(pages.board.map((s) => s.ttfb)) : null;
  console.log(
    `${variant}: board TTFB p50=${boardTtfb === null ? "n/a" : Math.round(boardTtfb)}ms, ` +
      `samples/page=${measured}, ops=${Object.keys(interactions).length}`,
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  process.exit(1);
});
