import { afterAll, describe, expect, it } from "vitest";

import { getProjects } from "@/lib/data";
import { sql } from "@/lib/db";

// Asserts the same rows the e2e suite renders, against the same seeded
// database. Values are read from the shared fixture rather than retyped, so a
// fixture change cannot leave these assertions describing stale data.
import { loadProjects, loadTasks } from "../../tests/fixtures/load";

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
