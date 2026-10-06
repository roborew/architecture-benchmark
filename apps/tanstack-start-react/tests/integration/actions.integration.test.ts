import { afterAll, describe, expect, it } from "vitest";

import {
  createProject,
  deleteProject,
  updateProject,
} from "@/lib/actions";
import { getProject, getProjects } from "@/lib/data";
import { sql } from "@/lib/db";

// Exercises the write path against the same seeded database the read tests use.
// `spec/contract.md` requires a mutation to be judged by its persisted result,
// so each case asserts through `getProject`/`getProjects` rather than by
// inspecting the action's return value alone.

afterAll(async () => {
  await sql.end();
});

function form(name: string, description = "") {
  // `append` rather than the constructor's entry-array argument: that overload
  // is not available on the FormData this Node version provides.
  const data = new FormData();
  data.append("name", name);
  data.append("description", description);

  return data;
}

/**
 * Runs an action that is expected to succeed.
 *
 * These actions return `{ redirectTo }` on success rather than redirecting,
 * so a successful mutation resolves and the row is already committed — which
 * is what each test then asserts through the read layer.
 */
async function run(action: Promise<unknown>): Promise<void> {
  await action;
}

async function makeProject(name: string, description = "") {
  await run(createProject(form(name, description)));
}

describe("createProject", () => {
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

    // Leave the fixture as it was found.
    await sql`DELETE FROM projects WHERE name = 'Integration created'`;
  });

  it("stores created_at so the row satisfies the NOT NULL constraint", async () => {
    await makeProject("Integration timestamp");

    const [row] = await sql<{ created_at: Date | null }[]>`
      SELECT created_at FROM projects WHERE name = 'Integration timestamp'
    `;

    expect(row?.created_at).toBeInstanceOf(Date);

    await sql`DELETE FROM projects WHERE name = 'Integration timestamp'`;
  });

  it("rejects a blank name without inserting", async () => {
    const before = await getProjects();

    const state = await createProject(form("   "));

    expect(state.errors?.name?.[0]).toBe("Project name is required.");
    expect(await getProjects()).toHaveLength(before.length);
  });

  it("rejects a name over the length bound without inserting", async () => {
    const before = await getProjects();

    const state = await createProject(form("x".repeat(201)));

    expect(state.errors?.name?.[0]).toContain("200 characters or fewer");
    expect(await getProjects()).toHaveLength(before.length);
  });

  it("trims surrounding whitespace from the name", async () => {
    await makeProject("  Integration trimmed  ");

    const found = (await getProjects()).find(
      (p) => p.name === "Integration trimmed",
    );

    expect(found).toBeDefined();

    await sql`DELETE FROM projects WHERE name = 'Integration trimmed'`;
  });

  it("allows an empty description, which the column defaults to ''", async () => {
    await makeProject("Integration no description");

    const found = (await getProjects()).find(
      (p) => p.name === "Integration no description",
    );

    expect(found?.description).toBe("");

    await sql`DELETE FROM projects WHERE name = 'Integration no description'`;
  });
});

describe("updateProject", () => {
  it("updates the intended row and nothing else", async () => {
    await makeProject("Integration to edit", "Before");

    const target = (await getProjects()).find(
      (p) => p.name === "Integration to edit",
    );
    expect(target).toBeDefined();

    // Commits the row; the assertions below read it back.
    await run(
      updateProject(target!.id, form("Integration edited", "After"))
    );

    const updated = await getProject(target!.id);
    expect(updated?.name).toBe("Integration edited");
    expect(updated?.description).toBe("After");

    await sql`DELETE FROM projects WHERE id = ${target!.id}`;
  });

  it("leaves created_at untouched", async () => {
    await makeProject("Integration keep created");

    const target = (await getProjects()).find(
      (p) => p.name === "Integration keep created",
    );
    const before = await getProject(target!.id);

    await run(
      updateProject(
        target!.id,
        form("Integration keep created", "New text"),
      )
    );

    const after = await getProject(target!.id);
    expect(after?.createdAt).toBe(before?.createdAt);
    expect(after?.description).toBe("New text");

    await sql`DELETE FROM projects WHERE id = ${target!.id}`;
  });

  it("reports a blank name and changes nothing", async () => {
    await makeProject("Integration reject edit");

    const target = (await getProjects()).find(
      (p) => p.name === "Integration reject edit",
    );

    const state = await updateProject(target!.id, form("  "));

    expect(state.errors?.name?.[0]).toBe("Project name is required.");
    expect((await getProject(target!.id))?.name).toBe(
      "Integration reject edit",
    );

    await sql`DELETE FROM projects WHERE id = ${target!.id}`;
  });

  it("reports rather than claims success for a row that no longer exists", async () => {
    const state = await updateProject(999_999, form("Ghost", ""));

    expect(state.message).toBe("That project no longer exists.");
  });
});

describe("deleteProject", () => {
  it("removes a project that has no tasks", async () => {
    await makeProject("Integration to delete");

    const target = (await getProjects()).find(
      (p) => p.name === "Integration to delete",
    );
    expect(target).toBeDefined();

    await run(
      deleteProject(target!.id)
    );

    expect(await getProject(target!.id)).toBeNull();
  });

  it("is blocked by the foreign key when the project still has tasks", async () => {
    // Seeded project 1 has three tasks. `tasks.project_id` is
    // ON DELETE RESTRICT (spec/schema.sql), so this must not succeed.
    const seeded = await getProject(1);
    expect(seeded?.taskCount).toBeGreaterThan(0);

    const state = await deleteProject(1);

    // A readable message rather than a thrown error the user cannot act on.
    expect(state.message).toContain("still has 3 tasks");

    // The row survives the failed delete.
    expect(await getProject(1)).not.toBeNull();
  });

  it("reports rather than claims success for a row that no longer exists", async () => {
    const state = await deleteProject(999_999);

    expect(state.message).toBe("That project no longer exists.");
  });
});

describe("getProject", () => {
  it("returns the same shape getProjects does, aggregates included", async () => {
    const fromList = (await getProjects()).find((p) => p.id === 1);
    const single = await getProject(1);

    expect(single).toEqual(fromList);
  });

  it("returns null for an id that matches no row", async () => {
    expect(await getProject(999_999)).toBeNull();
  });
});
