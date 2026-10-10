// Mutation capture (plan §5/§7). Drives the UI through each write op with
// Playwright, records the exact HTTP request the app makes (method, path,
// headers, body), and writes a replay template. This is the plan's "validated by
// capturing a real browser request": the write adapter is whatever the app
// actually sends, so Server Actions, tRPC, oRPC, REST and GraphQL are all
// handled by the same mechanism.
//
// The template bakes in the concrete title/comment and the concrete task id the
// capture used; the k6 replay substitutes a unique title and a leased pool id.
//
// Env: BENCH_BASE_URL, BENCH_VARIANT, BENCH_CAPTURE_REPORT.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  chromium,
  type Browser,
  type Locator,
  type Page,
  type Request,
} from "@playwright/test";

const baseUrl = required("BENCH_BASE_URL");
const variant = process.env.BENCH_VARIANT ?? "unknown";
const reportPath = required("BENCH_CAPTURE_REPORT");
const VIEWPORT = { width: 1365, height: 768 };

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export interface CapturedRequest {
  op: "create" | "update" | "delete" | "createWithComment";
  method: string;
  /** Absolute origin the app sent the mutation to (may differ from the UI origin
   *  for `spa-api`: the SPA calls the API). */
  origin: string;
  /** Path relative to the origin, e.g. `/api/tasks` or `/tasks/new`. */
  path: string;
  headers: Record<string, string>;
  body: string;
  id?: number;
  title?: string;
  comment?: string;
}

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const KEEP_HEADERS = (name: string): boolean =>
  name === "content-type" ||
  name === "next-action" ||
  name.startsWith("x-") ||
  name === "accept";

async function withRecorder(
  page: Page,
  run: () => Promise<void>,
): Promise<Request[]> {
  const recorded: Request[] = [];
  const listener = (request: Request) => {
    if (!MUTATION_METHODS.has(request.method())) return;
    const url = request.url();
    if (
      url.includes("/_next/") ||
      url.includes("/__vite") ||
      url.includes(".js")
    )
      return;
    recorded.push(request);
  };
  page.on("request", listener);
  try {
    await run();
  } finally {
    page.off("request", listener);
    await page.waitForLoadState("networkidle").catch(() => {});
  }
  return recorded;
}

async function toCapture(request: Request): Promise<{
  method: string;
  origin: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}> {
  const url = new URL(request.url());
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers())) {
    if (KEEP_HEADERS(name.toLowerCase())) headers[name] = value;
  }
  return {
    method: request.method(),
    origin: url.origin,
    path: `${url.pathname}${url.search}`,
    headers,
    body: request.postData() ?? "",
  };
}

function pick(requests: Request[], op: string): Request {
  if (requests.length === 0)
    throw new Error(`capture: no mutation request observed for '${op}'`);
  return requests[requests.length - 1]!;
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

async function firstProjectTaskId(page: Page): Promise<number> {
  await page.goto(`${baseUrl}/projects/1`, { waitUntil: "commit" });
  await page.getByTestId("task-row").first().getByTestId("task-title").click();
  await page.waitForURL(/\/tasks\/\d+/);
  return Number(page.url().match(/\/tasks\/(\d+)/)![1]);
}

async function capture(
  browser: Browser,
): Promise<Record<string, CapturedRequest>> {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  const ops: Record<string, CapturedRequest> = {};
  try {
    // create
    const createTitle = `bench-capture-create-${Date.now()}`;
    await page.goto(`${baseUrl}/tasks/new`, { waitUntil: "commit" });
    const createForm = page.getByTestId("create-task-form");
    await createForm.waitFor({ state: "visible" });
    await createForm.locator('[name="title"]').fill(createTitle);
    await chooseFirstOption(createForm.locator('[name="projectId"]'));
    const createRequests = await withRecorder(page, async () => {
      await createForm.locator('button[type="submit"]').first().click();
      await page
        .getByTestId("task-title")
        .filter({ hasText: createTitle })
        .first()
        .waitFor({ state: "visible" });
    });
    ops.create = {
      op: "create",
      ...(await toCapture(pick(createRequests, "create"))),
      title: createTitle,
    };

    // update
    const updateId = await firstProjectTaskId(page);
    const updateTitle = `bench-capture-update-${Date.now()}`;
    await page.goto(`${baseUrl}/tasks/${updateId}/edit`, {
      waitUntil: "commit",
    });
    const updateForm = page.getByTestId("update-task-form");
    await updateForm.waitFor({ state: "visible" });
    await updateForm.locator('[name="title"]').fill(updateTitle);
    const updateRequests = await withRecorder(page, async () => {
      await updateForm.locator('button[type="submit"]').first().click();
      await page
        .getByTestId("task-title")
        .filter({ hasText: updateTitle })
        .first()
        .waitFor({ state: "visible" });
    });
    ops.update = {
      op: "update",
      ...(await toCapture(pick(updateRequests, "update"))),
      id: updateId,
      title: updateTitle,
    };

    // delete
    const deleteId = await firstProjectTaskId(page);
    await page.goto(`${baseUrl}/tasks/${deleteId}`, { waitUntil: "commit" });
    const deleteRequests = await withRecorder(page, async () => {
      await page.getByTestId("delete-task-button").first().click();
      await page
        .waitForURL((url) => !url.pathname.endsWith(`/tasks/${deleteId}`), {
          timeout: 20_000,
        })
        .catch(() => {});
    });
    ops.delete = {
      op: "delete",
      ...(await toCapture(pick(deleteRequests, "delete"))),
      id: deleteId,
    };

    // create-with-comment
    const atomicTitle = `bench-capture-atomic-${Date.now()}`;
    const atomicComment = "bench capture comment";
    await page.goto(`${baseUrl}/tasks/new`, { waitUntil: "commit" });
    const atomicForm = page.getByTestId("create-with-comment-form");
    await atomicForm.waitFor({ state: "visible" });
    await atomicForm.locator('[name="title"]').fill(atomicTitle);
    await atomicForm.locator('[name="commentBody"]').fill(atomicComment);
    await chooseFirstOption(atomicForm.locator('[name="projectId"]'));
    await chooseFirstOption(atomicForm.locator('[name="commentAuthorId"]'));
    const atomicRequests = await withRecorder(page, async () => {
      await atomicForm.locator('button[type="submit"]').first().click();
      await page
        .waitForURL((url) => !url.pathname.endsWith("/tasks/new"), {
          timeout: 20_000,
        })
        .catch(() => {});
    });
    ops.createWithComment = {
      op: "createWithComment",
      ...(await toCapture(pick(atomicRequests, "createWithComment"))),
      title: atomicTitle,
      comment: atomicComment,
    };
  } finally {
    await context.close();
  }
  return ops;
}

async function main(): Promise<void> {
  const browser = await chromium.launch();
  let ops: Record<string, CapturedRequest> = {};
  try {
    ops = await capture(browser);
  } finally {
    await browser.close();
  }
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(
    reportPath,
    `${JSON.stringify({ variant, baseUrl, ops }, null, 2)}\n`,
  );
  console.log(
    `${variant}: captured ${Object.keys(ops).length} ops (${Object.values(ops)
      .map((o) => `${o.op}:${o.method}`)
      .join(", ")})`,
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  process.exit(1);
});
