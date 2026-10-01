import { afterAll, describe, expect, it } from "vitest";

import { getUser, getUserTasks } from "@/lib/data";
import { sql } from "@/lib/db";
import { loadProjects, loadTasks, loadUsers } from "../../tests/fixtures/load";

// Reads behind `/users/[id]`: the member header and their assigned tasks.
// Until now that page filtered the in-memory fixture by display name, which
// matched on a string rather than the key — two members with the same name
// would have shown each other's work.

afterAll(async () => {
  await sql.end();
});

const fixtureUsers = loadUsers();
const fixtureTasks = loadTasks();
const fixtureProjects = loadProjects();

describe("getUser", () => {
  it("returns the same shape getUsers does, aggregates included", async () => {
    const { getUsers } = await import("@/lib/data");

    const fromList = (await getUsers()).find((u) => u.id === 1);

    expect(await getUser(1)).toEqual(fromList);
  });

  it("carries the stored name and email", async () => {
    const fixture = fixtureUsers.find((u) => u.id === 2)!;

    const user = await getUser(2);

    expect(user?.name).toBe(fixture.displayName);
    expect(user?.email).toBe(fixture.email);
  });

  it("returns null for an id that matches no row", async () => {
    expect(await getUser(999_999)).toBeNull();
  });

  it("reports zero counts for a member with no tasks or comments", async () => {
    await sql`
      INSERT INTO users (display_name, email)
      VALUES ('Integration Idle', 'idle@example.test')
    `;

    try {
      const user = (await getUser(
        (
          await sql<{ id: number }[]>`
          SELECT id::int FROM users WHERE display_name = 'Integration Idle'
        `
        )[0].id,
      ))!;

      expect(user.assignedTaskCount).toBe(0);
      expect(user.openTaskCount).toBe(0);
      expect(user.commentCount).toBe(0);
    } finally {
      await sql`DELETE FROM users WHERE display_name = 'Integration Idle'`;
    }
  });

  it("finds a member by a name that another member shares", async () => {
    // Filtering by display name would return both; keying by id must not.
    await sql.begin(async (tx) => {
      await tx`
        INSERT INTO users (display_name, email) VALUES ('Integration Twin', 'twin-a@example.test')
      `;
      await tx`
        INSERT INTO users (display_name, email) VALUES ('Integration Twin', 'twin-b@example.test')
      `;
    });

    try {
      const [first, second] = await sql<{ id: number }[]>`
        SELECT id::int FROM users WHERE display_name = 'Integration Twin' ORDER BY id
      `;

      expect((await getUser(first.id))?.email).toBe("twin-a@example.test");
      expect((await getUser(second.id))?.email).toBe("twin-b@example.test");
    } finally {
      await sql`DELETE FROM users WHERE display_name = 'Integration Twin'`;
    }
  });
});

describe("getUserTasks", () => {
  it("returns only the tasks assigned to that member", async () => {
    const tasks = await getUserTasks(1);

    const expected = fixtureTasks
      .filter((t) => t.assigneeId === 1)
      // Newest updated first, matching the query's order.
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((t) => t.id);

    expect(tasks.map((t) => t.id)).toEqual(expected);
  });

  it("renders updatedAt as a UTC ISO instant, not a local-time string", async () => {
    const tasks = await getUserTasks(1);
    const fixture = fixtureTasks.find((t) => t.id === 101)!;

    const task = tasks.find((t) => t.id === 101);

    // Left to itself postgres.js renders a timestamptz in the *server's*
    // zone, so this row would read "2026-09-29 08:00:00+01" west of UTC. The
    // stored value is UTC and the fixture says so, so the projection has to
    // pin the zone rather than inherit the server's.
    expect(task?.updatedAt).toBe("2026-09-29T08:00:00Z");
    expect(task?.updatedAt).toBe(fixture.updatedAt);
  });

  it("carries the project name the table's project column renders", async () => {
    const tasks = await getUserTasks(1);

    for (const task of tasks) {
      const fixture = fixtureTasks.find((t) => t.id === task.id)!;

      expect(task.projectName).toBe(
        fixtureProjects.find((p) => p.id === fixture.projectId)!.name,
      );
    }
  });

  it("carries the fields the table renders", async () => {
    const tasks = await getUserTasks(1);
    const fixture = fixtureTasks.find((t) => t.id === 101)!;

    const task = tasks.find((t) => t.id === 101);

    expect(task?.title).toBe(fixture.title);
    expect(task?.description).toBe(fixture.description);
    expect(task?.status).toBe(fixture.status);
    expect(task?.updatedAt).toBe(fixture.updatedAt);
  });

  it("counts each task's comments", async () => {
    const tasks = await getUserTasks(1);

    expect(tasks.find((t) => t.id === 101)?.commentCount).toBe(2);
    expect(tasks.find((t) => t.id === 105)?.commentCount).toBe(0);
  });

  it("excludes tasks that belong to the member's project but not to them", async () => {
    // Robin is on projects 1 and 2. Task 103 is in project 1 but assigned to
    // Sam, so a project-scoped query would wrongly include it.
    const tasks = await getUserTasks(1);

    expect(tasks.map((t) => t.id)).not.toContain(103);
  });

  it("returns an empty list for a member with no assigned tasks", async () => {
    await sql`
      INSERT INTO users (display_name, email)
      VALUES ('Integration Unassigned', 'unassigned@example.test')
    `;

    try {
      const [row] = await sql<{ id: number }[]>`
        SELECT id::int FROM users WHERE display_name = 'Integration Unassigned'
      `;

      expect(await getUserTasks(row.id)).toEqual([]);
    } finally {
      await sql`DELETE FROM users WHERE display_name = 'Integration Unassigned'`;
    }
  });

  it("returns an empty list for an id that matches no member", async () => {
    expect(await getUserTasks(999_999)).toEqual([]);
  });

  it("agrees with the assigned-task count the member row reports", async () => {
    const user = await getUser(2);
    const tasks = await getUserTasks(2);

    // The header count and the table come from different queries, so this
    // catches a task that is counted but not listed.
    expect(tasks).toHaveLength(user!.assignedTaskCount);
  });
});
