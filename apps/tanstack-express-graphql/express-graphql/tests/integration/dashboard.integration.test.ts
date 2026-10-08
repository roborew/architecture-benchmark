// tests/integration/dashboard.integration.test.ts
//
// query Dashboard — the three sections the dashboard page renders. Exercises
// the full stack (POST /graphql → resolvers → models → Postgres) through
// supertest against the seeded test database, and asserts the exact rows the
// shared fixture produces so a SQL drift is caught here, not in the browser.
//
// The three sections mirror the reference variant (getDashboardStats,
// getRecentTasks, getDashboardProjects): the totals in one statement, the
// three most recently updated tasks, and the two busiest projects
// (COUNT(t.id) DESC, p.id ASC).

import { describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../../src/app.ts";

// The seeded fixture (spec/snapshots/correctness), worked through by hand:
//
//   users    1 Robin Andrew, 2 Alex Morgan, 3 Sam Taylor
//   projects 1 Website redesign (3 tasks), 2 Mobile application (2),
//            3 Platform migration (1)
//   tasks    101 (u1, in progress), 102 (u2, todo), 103 (u3, done),
//            104 (u2, todo), 105 (u1, in progress), 106 (u3, todo)

// One document, no arguments: the SPA fetches all three sections together.
const DASHBOARD_QUERY = `
  query Dashboard {
    dashboard {
      stats {
        projectCount
        totalTasks
        openTasks
        peopleCount
        todoTasks
        inProgressTasks
        doneTasks
      }
      recentTasks {
        id
        title
        projectName
        status
        assigneeName
        updatedAt
      }
      projects {
        id
        name
        description
        taskCount
        openTaskCount
        peopleCount
      }
    }
  }
`;

function queryDashboard() {
  return request(createApp())
    .post("/graphql")
    .send({ query: DASHBOARD_QUERY, variables: {} });
}

describe("query Dashboard", () => {
  it("returns the stats, recent tasks and busiest projects in one document", async () => {
    const response = await queryDashboard();

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/json/);

    // toEqual (not toMatchObject): the document's shape is the API contract.
    expect(response.body.data.dashboard).toEqual({
      stats: {
        projectCount: 3,
        totalTasks: 6,
        openTasks: 5, // 103 is done
        peopleCount: 3,
        todoTasks: 3, // 102, 104, 106
        inProgressTasks: 2, // 101, 105
        doneTasks: 1, // 103
      },
      recentTasks: [
        {
          id: 101,
          title: "Draft navigation model",
          projectName: "Website redesign",
          status: "in progress",
          assigneeName: "Robin Andrew",
          updatedAt: "2026-09-29T08:00:00Z",
        },
        {
          id: 102,
          title: "Confirm breakpoint rules",
          projectName: "Website redesign",
          status: "todo",
          assigneeName: "Alex Morgan",
          updatedAt: "2026-09-28T11:20:00Z",
        },
        {
          id: 105,
          title: "Build profile screen",
          projectName: "Mobile application",
          status: "in progress",
          assigneeName: "Robin Andrew",
          updatedAt: "2026-09-28T09:30:00Z",
        },
      ],
      projects: [
        {
          id: 1,
          name: "Website redesign",
          description: "Refresh the public website and onboarding experience.",
          taskCount: 3,
          openTaskCount: 2,
          peopleCount: 3,
        },
        {
          id: 2,
          name: "Mobile application",
          description:
            "Ship the first mobile experience for existing workspace members.",
          taskCount: 2,
          openTaskCount: 2,
          peopleCount: 2,
        },
      ],
    });
  });

  it("orders recent tasks by most recently updated, then id descending", async () => {
    const response = await queryDashboard();

    // "Recent activity" is when the work last moved (updated_at), which is
    // also what the updateTask mutation advances.
    expect(
      response.body.data.dashboard.recentTasks.map(
        (task: { id: number }) => task.id,
      ),
    ).toEqual([101, 102, 105]);
  });

  it("orders the projects by task count descending, then id ascending", async () => {
    const response = await queryDashboard();

    expect(
      response.body.data.dashboard.projects.map((p: { id: number }) => p.id),
    ).toEqual([1, 2]);
  });
});
