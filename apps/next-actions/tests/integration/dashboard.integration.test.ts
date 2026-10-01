import { afterAll, describe, expect, it } from "vitest";

import {
  getDashboardProjects,
  getDashboardStats,
  getRecentTasks,
} from "@/lib/data";
import { sql } from "@/lib/db";
import {
  loadProjects,
  loadRawRows,
  loadTasks,
  loadUsers,
} from "../fixtures/load";

// The dashboard read three independent aggregates from the in-memory fixture.
// Judged against the same rows the rest of the app asserts, so a write made
// through a server action shows up on the landing page too.

afterAll(async () => {
  await sql.end();
});

const fixtureTasks = loadTasks();
const fixtureUsers = loadUsers();
const fixtureProjects = loadProjects();

const open = fixtureTasks.filter((t) => t.status !== "done");

describe("getDashboardStats", () => {
  it("counts the workspace totals", async () => {
    expect(await getDashboardStats()).toEqual({
      projectCount: fixtureProjects.length,
      totalTasks: fixtureTasks.length,
      openTasks: open.length,
      peopleCount: fixtureUsers.length,
      todoTasks: fixtureTasks.filter((t) => t.status === "todo").length,
      inProgressTasks: fixtureTasks.filter((t) => t.status === "in progress")
        .length,
      doneTasks: fixtureTasks.filter((t) => t.status === "done").length,
    });
  });

  it("counts every status into exactly one bucket", async () => {
    const stats = await getDashboardStats();

    expect(stats.todoTasks + stats.inProgressTasks + stats.doneTasks).toBe(
      stats.totalTasks,
    );
  });

  it("treats a done task as not open", async () => {
    const stats = await getDashboardStats();

    expect(stats.openTasks).toBe(stats.totalTasks - stats.doneTasks);
  });

  it("reflects a task created after the page was first rendered", async () => {
    const before = await getDashboardStats();

    await sql`
      INSERT INTO tasks (project_id, assignee_id, title, description, status, created_at, updated_at)
      VALUES (1, NULL, 'Integration stat', '', 'todo', '2026-10-30T09:00:00Z', '2026-10-30T09:00:00Z')
    `;

    try {
      const after = await getDashboardStats();

      expect(after.totalTasks).toBe(before.totalTasks + 1);
      expect(after.openTasks).toBe(before.openTasks + 1);
      expect(after.todoTasks).toBe(before.todoTasks + 1);
    } finally {
      await sql`DELETE FROM tasks WHERE title = 'Integration stat'`;
    }
  });

  it("returns zeroed stats for an empty workspace", async () => {
    // Reached by deleting the seeded rows inside a transaction, so the
    // dashboard's "nothing here yet" path is exercised rather than assumed.
    await sql.begin(async (tx) => {
      await tx`DELETE FROM comments`;
      await tx`DELETE FROM tasks`;
      await tx`DELETE FROM projects`;
      await tx`DELETE FROM users`;
    });

    try {
      expect(await getDashboardStats()).toEqual({
        projectCount: 0,
        totalTasks: 0,
        openTasks: 0,
        peopleCount: 0,
        todoTasks: 0,
        inProgressTasks: 0,
        doneTasks: 0,
      });
    } finally {
      // Re-seed from the shared fixture rather than hand-inserting rows, so
      // the rows the other suites in this file rely on are restored exactly.
      const rows = loadRawRows();

      await sql.begin(async (tx) => {
        for (const table of [
          "users",
          "projects",
          "tasks",
          "comments",
        ] as const) {
          for (const row of rows[table]) {
            await tx`INSERT INTO ${tx(table)} ${tx(row)}`;
          }
        }
      });
    }
  });
});

describe("getRecentTasks", () => {
  it("returns the newest tasks by updated_at", async () => {
    const tasks = await getRecentTasks();

    const expected = [...fixtureTasks]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 3)
      .map((t) => t.id);

    expect(tasks.map((t) => t.id)).toEqual(expected);
  });

  it("carries the project name and no project id or comment count", async () => {
    const tasks = await getRecentTasks();

    for (const task of tasks) {
      const fixture = fixtureTasks.find((t) => t.id === task.id)!;

      expect(task.projectName).toBe(
        fixtureProjects.find((p) => p.id === fixture.projectId)!.name,
      );
      // The recent-tasks table has no project column and no comment count.
      expect(task).not.toHaveProperty("projectId");
      expect(task).not.toHaveProperty("commentCount");
    }
  });

  it("never returns more than the dashboard shows", async () => {
    expect((await getRecentTasks()).length).toBeLessThanOrEqual(3);
  });

  it("floats a just-updated task to the top", async () => {
    await sql`
      INSERT INTO tasks (project_id, assignee_id, title, description, status, created_at, updated_at)
      VALUES (1, NULL, 'Integration freshest', '', 'todo', '2026-10-31T09:00:00Z', '2026-10-31T09:00:00Z')
    `;

    try {
      expect((await getRecentTasks())[0].title).toBe("Integration freshest");
    } finally {
      await sql`DELETE FROM tasks WHERE title = 'Integration freshest'`;
    }
  });
});

describe("getDashboardProjects", () => {
  it("returns the busiest projects first", async () => {
    const projects = await getDashboardProjects();

    const counts = projects.map(
      (p) => fixtureTasks.filter((t) => t.projectId === p.id).length,
    );

    expect(projects.map((p) => p.id)).toEqual([1, 2]);
    expect(counts).toEqual([3, 2]);
  });

  it("carries the counts the card renders but no creation date", async () => {
    const projects = await getDashboardProjects();

    for (const project of projects) {
      const tasks = fixtureTasks.filter((t) => t.projectId === project.id);

      expect(project.taskCount).toBe(tasks.length);
      expect(project.openTaskCount).toBe(
        tasks.filter((t) => t.status !== "done").length,
      );
      expect(project).not.toHaveProperty("createdAt");
    }
  });

  it("never returns more than the dashboard renders", async () => {
    expect((await getDashboardProjects()).length).toBeLessThanOrEqual(2);
  });
});
