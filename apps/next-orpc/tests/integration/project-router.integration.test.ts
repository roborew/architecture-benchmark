import { afterAll, describe, expect, it } from "vitest";

import { getProject, getProjects, getProjectTasks } from "@/lib/data";
import { sql } from "@/lib/db";
import { createRouterClient } from "@orpc/server";

import { router } from "@/orpc/routers/_app";

// The projects write path, judged by its persisted result rather than by the
// procedure's return value alone (spec/contract.md).
//
// This replaces tests/integration/actions.integration.test.ts, which drove the
// createProject/updateProject/deleteProject Server Actions. Those ended a
// successful write in `revalidatePath` + `redirect`, both of which throw outside
// a Next request context, so each success case had to be wrapped in
// `expect(...).rejects.toThrow()` and then read back. A procedure returns
// `{ ok: true, id }` instead, so the id it reports is the id asserted against and
// the throws disappear.

afterAll(async () => {
  await sql.end();
});

// oRPC's equivalent of tRPC's `appRouter.createCaller({})`: an in-process
// client, so the procedure runs directly with no HTTP hop.
const caller = createRouterClient(router, { context: {} });

/** Narrows a refused result so the field errors and message are readable. */
function refusal(result: Awaited<ReturnType<typeof caller.projects.create>>) {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected the procedure to refuse");
  return result;
}

async function makeProject(name: string, description = "") {
  const result = await caller.projects.create({ name, description });

  if (!result.ok) {
    throw new Error(`could not create ${name}: ${result.message}`);
  }

  const created = await getProject(result.id);
  expect(created, `could not read back ${name}`).not.toBeNull();

  return created!;
}

async function removeProject(name: string) {
  await sql`DELETE FROM projects WHERE name = ${name}`;
}

describe("projects.create", () => {
  it("inserts a row that the read layer returns", async () => {
    const before = await getProjects();

    await makeProject(
      "Integration created",
      "Written by the integration suite.",
    );

    const after = await getProjects();
    const created = after.find((p) => p.name === "Integration created");

    expect(created).toBeDefined();
    expect(created?.description).toBe("Written by the integration suite.");
    // A new project has no tasks, so its aggregates are zero rather than null.
    expect(created?.taskCount).toBe(0);
    expect(created?.openTaskCount).toBe(0);
    expect(created?.peopleCount).toBe(0);

    expect(after).toHaveLength(before.length + 1);

    await removeProject("Integration created");
  });

  it("stores created_at so the row satisfies the NOT NULL constraint", async () => {
    await makeProject("Integration timestamp");

    const [row] = await sql<{ created_at: Date | null }[]>`
      SELECT created_at FROM projects WHERE name = 'Integration timestamp'
    `;

    expect(row?.created_at).toBeInstanceOf(Date);

    await removeProject("Integration timestamp");
  });

  it("reports the allocated id", async () => {
    // spec/contract.md: a create must leave a persisted id behind, not merely
    // return success.
    const result = await caller.projects.create({ name: "Integration id" });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(await getProject(result.id)).not.toBeNull();

    await removeProject("Integration id");
  });

  it("rejects a blank name without inserting", async () => {
    const before = await getProjects();

    const result = refusal(await caller.projects.create({ name: "   " }));

    expect(result.errors?.name?.[0]).toBe("Project name is required.");
    expect(await getProjects()).toHaveLength(before.length);
  });

  it("rejects a name over the length bound without inserting", async () => {
    const before = await getProjects();

    const result = refusal(
      await caller.projects.create({ name: "x".repeat(201) }),
    );

    expect(result.errors?.name?.[0]).toContain("200 characters or fewer");
    expect(await getProjects()).toHaveLength(before.length);
  });

  it("trims surrounding whitespace from the name", async () => {
    await makeProject("  Integration trimmed  ");

    const found = (await getProjects()).find(
      (p) => p.name === "Integration trimmed",
    );

    expect(found).toBeDefined();

    await removeProject("Integration trimmed");
  });

  it("allows an empty description, which the column defaults to ''", async () => {
    await makeProject("Integration no description");

    const found = (await getProjects()).find(
      (p) => p.name === "Integration no description",
    );

    expect(found?.description).toBe("");

    await removeProject("Integration no description");
  });
});

describe("projects.update", () => {
  it("updates the intended row and nothing else", async () => {
    const target = await makeProject("Integration to edit", "Before");

    const result = await caller.projects.update({
      id: target.id,
      name: "Integration edited",
      description: "After",
    });

    expect(result.ok).toBe(true);

    const updated = await getProject(target.id);
    expect(updated?.name).toBe("Integration edited");
    expect(updated?.description).toBe("After");

    await removeProject("Integration edited");
  });

  it("leaves created_at untouched", async () => {
    const target = await makeProject("Integration keep created");
    const before = await getProject(target.id);

    await caller.projects.update({
      id: target.id,
      name: "Integration keep created",
      description: "New text",
    });

    const after = await getProject(target.id);
    expect(after?.createdAt).toBe(before?.createdAt);
    expect(after?.description).toBe("New text");

    await removeProject("Integration keep created");
  });

  it("keeps the aggregate counts attached to the id", async () => {
    // Seeded project 1 has three tasks. Editing the name must not disturb those
    // aggregates, which are keyed on the id.
    const before = await getProject(1);
    expect(before?.taskCount).toBeGreaterThan(0);

    await caller.projects.update({
      id: 1,
      name: "Integration renamed board",
      description: before!.description,
    });

    const after = await getProject(1);
    expect(after?.taskCount).toBe(before?.taskCount);
    expect(after?.name).toBe("Integration renamed board");

    // Put the seeded row back exactly as it was found.
    await caller.projects.update({
      id: 1,
      name: before!.name,
      description: before!.description,
    });
  });

  it("reports a blank name and changes nothing", async () => {
    const target = await makeProject("Integration reject edit");

    const result = refusal(
      await caller.projects.update({
        id: target.id,
        name: "  ",
        description: "Ignored",
      }),
    );

    expect(result.errors?.name?.[0]).toBe("Project name is required.");
    expect((await getProject(target.id))?.name).toBe(
      "Integration reject edit",
    );

    await removeProject("Integration reject edit");
  });

  it("reports rather than claims success for a row that no longer exists", async () => {
    const result = refusal(
      await caller.projects.update({
        id: 999_999,
        name: "Ghost",
        description: "",
      }),
    );

    expect(result.message).toBe("That project no longer exists.");
  });
});

describe("projects.delete", () => {
  it("removes a project that has no tasks", async () => {
    const target = await makeProject("Integration to delete");

    const result = await caller.projects.delete({ id: target.id });

    expect(result.ok).toBe(true);
    expect(await getProject(target.id)).toBeNull();
  });

  it("is blocked by the foreign key when the project still has tasks", async () => {
    // Seeded project 1 has three tasks. `tasks.project_id` is
    // ON DELETE RESTRICT (spec/schema.sql), so this must not succeed.
    const seeded = await getProject(1);
    expect(seeded?.taskCount).toBeGreaterThan(0);

    const result = refusal(await caller.projects.delete({ id: 1 }));

    // A readable message rather than a thrown error the user cannot act on.
    expect(result.message).toContain("still has 3 tasks");

    // The row survives the failed delete.
    expect(await getProject(1)).not.toBeNull();
  });

  it("reports rather than claims success for a row that no longer exists", async () => {
    const result = refusal(await caller.projects.delete({ id: 999_999 }));

    expect(result.message).toBe("That project no longer exists.");
  });
});

describe("projects reads", () => {
  it("byId returns the same shape list does, aggregates included", async () => {
    const fromList = (await getProjects()).find((p) => p.id === 1);
    const single = await caller.projects.byId({ id: 1 });

    expect(single).toEqual(fromList);
  });

  it("byId returns null for an id that matches no row", async () => {
    expect(await caller.projects.byId({ id: 999_999 })).toBeNull();
  });

  it("list returns every project when the search is empty", async () => {
    expect(await caller.projects.list({ search: "" })).toHaveLength(
      (await getProjects()).length,
    );
  });

  it("tasks scopes by project, not by name", async () => {
    const rows = await caller.projects.tasks({ id: 1 });

    // Same read the detail page performs, so a change to either the procedure or
    // the query layer is caught here rather than only in the browser.
    expect(rows).toEqual(await getProjectTasks(1));
  });
});
