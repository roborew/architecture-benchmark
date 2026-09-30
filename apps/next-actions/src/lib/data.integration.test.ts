import { afterAll, describe, expect, it } from "vitest";

import { getProjects, getUsers } from "@/lib/data";
import { sql } from "@/lib/db";

// Asserts the same rows the e2e suite renders, against the same seeded
// database. Values are read from the shared fixture rather than retyped, so a
// fixture change cannot leave these assertions describing stale data.
import {
  loadComments,
  loadProjects,
  loadTasks,
  loadUsers,
} from "../../tests/fixtures/load";

afterAll(async () => {
  await sql.end();
});

describe("getProjects", () => {
  it("returns every seeded project with its aggregate counts", async () => {
    const projects = await getProjects();

    const fixtureProjects = loadProjects();
    const fixtureTasks = loadTasks();

    expect(projects).toHaveLength(fixtureProjects.length);

    for (const fixture of fixtureProjects) {
      const tasks = fixtureTasks.filter((t) => t.projectId === fixture.id);
      const open = tasks.filter((t) => t.status !== "done");
      const assignees = new Set(
        tasks.filter((t) => t.assigneeId !== null).map((t) => t.assigneeId),
      );

      const actual = projects.find((p) => p.id === fixture.id);

      expect(actual, `project ${fixture.id} missing`).toBeDefined();
      expect(actual?.name).toBe(fixture.name);
      expect(actual?.description).toBe(fixture.description);
      expect(actual?.taskCount).toBe(tasks.length);
      expect(actual?.openTaskCount).toBe(open.length);
      expect(actual?.peopleCount).toBe(assignees.size);
    }
  });

  it("counts a done task as not open", async () => {
    const projects = await getProjects();

    // Project 1's third task is seeded `done`.
    const project = projects.find((p) => p.id === 1);

    expect(project?.taskCount).toBe(3);
    expect(project?.openTaskCount).toBe(2);
  });

  it("matches a project name case-insensitively", async () => {
    const projects = await getProjects("WEBSITE");

    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe("Website redesign");
  });

  it("matches on description as well as name", async () => {
    const projects = await getProjects("onboarding");

    expect(projects).toHaveLength(1);
    expect(projects[0].id).toBe(1);
  });

  it("returns nothing for a term that matches no project", async () => {
    expect(await getProjects("no-such-project")).toHaveLength(0);
  });

  it("treats LIKE wildcards in the term as literal characters", async () => {
    // A bare `%` would otherwise match every row and hide a real escaping bug.
    expect(await getProjects("%")).toHaveLength(0);
    expect(await getProjects("_")).toHaveLength(0);
  });

  it("ignores surrounding whitespace", async () => {
    expect(await getProjects("  Website redesign  ")).toHaveLength(1);
  });

  it("returns the most recently created project first", async () => {
    const projects = await getProjects();

    // Fixture timestamps differ, so the ordering is deterministic and this
    // catches a dropped ORDER BY.
    expect(projects.map((p) => p.id)).toEqual([1, 2, 3]);
  });
});

describe("getUsers", () => {
  it("returns every seeded user with its aggregate counts", async () => {
    const users = await getUsers();

    const fixtureUsers = loadUsers();
    const fixtureTasks = loadTasks();
    const fixtureComments = loadComments();

    expect(users).toHaveLength(fixtureUsers.length);

    for (const fixture of fixtureUsers) {
      const assigned = fixtureTasks.filter((t) => t.assigneeId === fixture.id);
      const open = assigned.filter((t) => t.status !== "done");
      const authored = fixtureComments.filter((c) => c.authorId === fixture.id);

      const actual = users.find((u) => u.id === fixture.id);

      expect(actual, `user ${fixture.id} missing`).toBeDefined();
      expect(actual?.name).toBe(fixture.displayName);
      expect(actual?.email).toBe(fixture.email);
      expect(actual?.assignedTaskCount).toBe(assigned.length);
      expect(actual?.openTaskCount).toBe(open.length);
      expect(actual?.commentCount).toBe(authored.length);
    }
  });

  it("does not multiply counts when a user has tasks and comments", async () => {
    const users = await getUsers();

    // Alex is assigned 2 tasks and authored 2 comments. Joining both tables in a
    // single pass fans out to 4 rows, so a plain COUNT over the join reports 4
    // tasks for a user who only has 2. DISTINCT on each side's id is what keeps
    // the two aggregates independent.
    const alex = users.find((u) => u.email === "alex@example.test");

    expect(alex?.assignedTaskCount).toBe(2);
    expect(alex?.openTaskCount).toBe(2);
    expect(alex?.commentCount).toBe(2);
  });

  it("counts a done task as not open", async () => {
    const users = await getUsers();

    // Sam is assigned tasks 103 (`done`) and 106 (`todo`).
    const sam = users.find((u) => u.email === "sam@example.test");

    expect(sam?.assignedTaskCount).toBe(2);
    expect(sam?.openTaskCount).toBe(1);
  });

  it("matches a user name case-insensitively", async () => {
    const users = await getUsers("ROBIN");

    expect(users).toHaveLength(1);
    expect(users[0].name).toBe("Robin Andrew");
  });

  it("matches on email as well as name", async () => {
    const users = await getUsers("alex@example.test");

    expect(users).toHaveLength(1);
    expect(users[0].id).toBe(2);
  });

  it("returns nothing for a term that matches no user", async () => {
    expect(await getUsers("no-such-person")).toHaveLength(0);
  });

  it("treats LIKE wildcards in the term as literal characters", async () => {
    // A bare `%` would otherwise match every row and hide a real escaping bug.
    expect(await getUsers("%")).toHaveLength(0);
    expect(await getUsers("_")).toHaveLength(0);
  });

  it("ignores surrounding whitespace", async () => {
    const users = await getUsers("  Robin Andrew  ");

    expect(users).toHaveLength(1);
    expect(users[0].id).toBe(1);
  });

  it("returns users ordered by name descending", async () => {
    const users = await getUsers();

    // Fixture names differ, so the ordering is deterministic and this catches a
    // dropped or flipped ORDER BY.
    expect(users.map((u) => u.name)).toEqual([
      "Sam Taylor",
      "Robin Andrew",
      "Alex Morgan",
    ]);
  });
});
