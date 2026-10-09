// Shared black-box correctness suite (plan R5, §6.3). Implements the observable
// contract in spec/contract.md against `BENCH_BASE_URL`, using only contract
// routes and `data-testid`s — no implementation-specific selectors.
//
// Two mappings are agreed in docs/r5-contract-changes.md: the "projects index"
// is `/projects` (not `/`), and the create forms live at `/tasks/new`.
//
// Note on status text: the contract requires the *raw stored value* in the DOM,
// and allows CSS `text-transform: capitalize` for the visual label. So this
// suite reads `textContent` (unaffected by CSS), never `innerText`.

import { expect, test, type Locator, type Page } from "@playwright/test";

const RAW_STATUSES = ["todo", "in progress", "done"] as const;
const PAGE_SIZE = 25;
const COMMENTS_SHOWN = 10;

function uniqueTitle(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/** Raw text of each element (textContent, so CSS transforms are ignored). */
function texts(locator: Locator): Promise<string[]> {
  return locator.evaluateAll((elements) =>
    elements.map((element) => (element.textContent ?? "").trim()),
  );
}

async function firstTaskRow(page: Page): Promise<Locator> {
  const row = page.getByTestId("task-row").first();
  await expect(row).toBeVisible();
  return row;
}

/** Fill the task fields shared by the create and create-with-comment forms. */
async function fillTaskFields(form: Locator, title: string): Promise<void> {
  await form.locator('[name="title"]').fill(title);
  const description = form.locator('[name="description"]');
  if (await description.count()) await description.fill("created by the rig");
  await chooseFirstOption(form.locator('[name="projectId"]'));
}

/** Pick the first non-empty option of a required select. */
async function chooseFirstOption(select: Locator): Promise<void> {
  if (!(await select.count())) return;
  const current = await select.inputValue().catch(() => "");
  if (current) return;
  const values = await select
    .locator("option")
    .evaluateAll((options) =>
      options.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
    );
  if (values[0]) await select.selectOption(values[0]);
}

async function submit(page: Page, form: Locator): Promise<void> {
  await form.locator('button[type="submit"]').first().click();
  // A successful write redirects (to the list or a detail page). Wait for that
  // navigation so the next step observes committed data, not an in-flight action.
  await page
    .waitForURL((url) => !url.pathname.endsWith("/tasks/new"), {
      timeout: 20_000,
    })
    .catch(async () => {
      await page.waitForTimeout(2_000);
    });
}

/** Find the created task wherever the app landed, and open its detail page. */
async function openCreatedTask(page: Page, title: string): Promise<void> {
  await page.goto("/tasks");
  const row = page.getByTestId("task-row").filter({ hasText: title }).first();
  await expect(
    row,
    `created task "${title}" not found in the task list`,
  ).toBeVisible();
  await expect(row.getByTestId("task-title")).toHaveText(title);
  await row.getByTestId("task-title").click();
  await expect(page).toHaveURL(/\/tasks\/\d+/);
  await expect(page.getByTestId("task-title").first()).toHaveText(title);
}

test.describe("correctness contract", () => {
  test("projects index lists project links", async ({ page }) => {
    await page.goto("/projects");
    const links = page.getByTestId("project-link");
    await expect(links.first()).toBeVisible();
    expect(await links.count()).toBeGreaterThan(0);
  });

  test("board: rows are paged, carry raw statuses, and filter by tab", async ({
    page,
  }) => {
    await page.goto("/projects");
    await page.getByTestId("project-link").first().click();
    await expect(page).toHaveURL(/\/projects\/\d+/);

    const rows = page.getByTestId("task-row");
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeLessThanOrEqual(PAGE_SIZE);

    const statuses = await texts(rows.getByTestId("task-status"));
    expect(statuses.length).toBeGreaterThan(0);
    for (const status of statuses) {
      expect(RAW_STATUSES, `unexpected status text "${status}"`).toContain(
        status as (typeof RAW_STATUSES)[number],
      );
    }
    for (const assignee of await texts(rows.getByTestId("task-assignee"))) {
      expect(assignee.length).toBeGreaterThan(0);
    }

    // The small fixture gives a project ~200 tasks, so pagination is present.
    await expect(page.getByTestId("next-page")).toBeVisible();

    // Filtering by a status tab shows only that status.
    await page
      .locator('[data-testid="status-filter"][data-status="done"]')
      .click();
    await expect
      .poll(async () => {
        const filtered = await texts(
          page.getByTestId("task-row").getByTestId("task-status"),
        );
        return filtered.length > 0 && filtered.every((text) => text === "done");
      })
      .toBe(true);

    // "all" clears the filter.
    await page
      .locator('[data-testid="status-filter"][data-status="all"]')
      .click();
    await expect
      .poll(async () => page.getByTestId("task-row").count())
      .toBeGreaterThan(PAGE_SIZE - 1);
  });

  test("task detail shows the contract fields and at most ten comments", async ({
    page,
  }) => {
    await page.goto("/projects/1");
    await (await firstTaskRow(page)).getByTestId("task-title").click();
    await expect(page).toHaveURL(/\/tasks\/\d+/);

    for (const testid of [
      "task-detail",
      "task-title",
      "task-status",
      "task-description",
      "task-assignee",
      "project-link",
      "task-updated-at",
    ]) {
      await expect(
        page.getByTestId(testid).first(),
        `missing ${testid}`,
      ).toBeVisible();
    }
    const status =
      (await page.getByTestId("task-status").first().textContent())?.trim() ??
      "";
    expect(RAW_STATUSES).toContain(status as (typeof RAW_STATUSES)[number]);

    expect(await page.getByTestId("comment-row").count()).toBeLessThanOrEqual(
      COMMENTS_SHOWN,
    );
  });

  test("an unknown task id shows not-found", async ({ page }) => {
    await page.goto("/tasks/999999");
    await expect(page.getByTestId("not-found").first()).toBeVisible();
  });

  test("create-task persists and survives a reload", async ({ page }) => {
    const title = uniqueTitle("Rig created task");
    await page.goto("/tasks/new");
    const form = page.getByTestId("create-task-form");
    await expect(form).toBeVisible();
    await fillTaskFields(form, title);
    await submit(page, form);

    // Apps land on the task list or the detail page; find the new task either way.
    await openCreatedTask(page, title);
    await page.reload();
    await expect(page.getByTestId("task-title").first()).toHaveText(title);
  });

  test("create-with-comment is atomic: task and its first comment both exist", async ({
    page,
  }) => {
    const title = uniqueTitle("Rig atomic task");
    await page.goto("/tasks/new");
    const form = page.getByTestId("create-with-comment-form");
    await expect(form).toBeVisible();
    await fillTaskFields(form, title);
    await form
      .locator('[name="commentBody"]')
      .fill("First comment from the rig");
    await chooseFirstOption(form.locator('[name="commentAuthorId"]'));
    await submit(page, form);

    await openCreatedTask(page, title);
    await expect(page.getByTestId("comment-row").first()).toBeVisible();
    await expect(
      page.getByTestId("comment-row").first().getByTestId("comment-body"),
    ).toHaveText("First comment from the rig");
  });

  test("update commits the change and keeps it after reload", async ({
    page,
  }) => {
    await page.goto("/projects/1");
    await (await firstTaskRow(page)).getByTestId("task-title").click();
    await expect(page).toHaveURL(/\/tasks\/\d+/);
    const id = page.url().match(/\/tasks\/(\d+)/)![1]!;
    await expect(page.getByTestId("task-updated-at").first()).toBeVisible();

    await page.goto(`/tasks/${id}/edit`);
    const form = page.getByTestId("update-task-form");
    await expect(form).toBeVisible();
    const title = uniqueTitle("Rig updated");
    await form.locator('[name="title"]').fill(title);
    await submit(page, form);

    await expect(page.getByTestId("task-title").first()).toHaveText(title);
    await page.goto(`/tasks/${id}`);
    await expect(page.getByTestId("task-title").first()).toHaveText(title);
    await expect(page.getByTestId("task-updated-at").first()).toBeVisible();
  });

  test("delete removes the task (its URL then shows not-found)", async ({
    page,
  }) => {
    await page.goto("/projects/1");
    await (await firstTaskRow(page)).getByTestId("task-title").click();
    await expect(page).toHaveURL(/\/tasks\/\d+/);
    const id = page.url().match(/\/tasks\/(\d+)/)![1]!;

    await page.getByTestId("delete-task-button").first().click();
    await expect(page).not.toHaveURL(new RegExp(`/tasks/${id}$`));
    await page.goto(`/tasks/${id}`);
    await expect(page.getByTestId("not-found").first()).toBeVisible();
  });
});
