"""tests/integration/test_dashboard_routes.py

GET /api/dashboard — the three sections the dashboard page renders. Exercises
the full HTTP stack (routes → controller → model → Postgres) through the
FastAPI TestClient against the seeded test database, and asserts the exact
rows the shared fixture produces so a SQL drift is caught here, not in the
browser.

The three sections mirror the reference variant (getDashboardStats,
getRecentTasks, getDashboardProjects): the totals in one statement, the
three most recently updated tasks, and the two busiest projects
(COUNT(t.id) DESC, p.id ASC).
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration

# The seeded fixture (spec/snapshots/correctness), worked through by hand:
#
#   users    1 Robin Andrew, 2 Alex Morgan, 3 Sam Taylor
#   projects 1 Website redesign (3 tasks), 2 Mobile application (2),
#            3 Platform migration (1)
#   tasks    101 (u1, in progress), 102 (u2, todo), 103 (u3, done),
#            104 (u2, todo), 105 (u1, in progress), 106 (u3, todo)


class TestGetApiDashboard:
    def test_returns_the_stats_recent_tasks_and_busiest_projects_in_one_body(
        self, client: TestClient
    ) -> None:
        response = client.get("/api/dashboard")

        assert response.status_code == 200
        assert "json" in response.headers["content-type"]

        # Full equality (not subset matching): the body shape is the API
        # contract.
        assert response.json() == {
            "stats": {
                "projectCount": 3,
                "totalTasks": 6,
                "openTasks": 5,  # 103 is done
                "peopleCount": 3,
                "todoTasks": 3,  # 102, 104, 106
                "inProgressTasks": 2,  # 101, 105
                "doneTasks": 1,  # 103
            },
            "recentTasks": [
                {
                    "id": 101,
                    "title": "Draft navigation model",
                    "projectName": "Website redesign",
                    "status": "in progress",
                    "assigneeName": "Robin Andrew",
                    "updatedAt": "2026-09-29T08:00:00Z",
                },
                {
                    "id": 102,
                    "title": "Confirm breakpoint rules",
                    "projectName": "Website redesign",
                    "status": "todo",
                    "assigneeName": "Alex Morgan",
                    "updatedAt": "2026-09-28T11:20:00Z",
                },
                {
                    "id": 105,
                    "title": "Build profile screen",
                    "projectName": "Mobile application",
                    "status": "in progress",
                    "assigneeName": "Robin Andrew",
                    "updatedAt": "2026-09-28T09:30:00Z",
                },
            ],
            "projects": [
                {
                    "id": 1,
                    "name": "Website redesign",
                    "description": "Refresh the public website and onboarding experience.",
                    "taskCount": 3,
                    "openTaskCount": 2,
                    "peopleCount": 3,
                },
                {
                    "id": 2,
                    "name": "Mobile application",
                    "description": (
                        "Ship the first mobile experience for existing workspace members."
                    ),
                    "taskCount": 2,
                    "openTaskCount": 2,
                    "peopleCount": 2,
                },
            ],
        }

    def test_orders_recent_tasks_by_most_recently_updated_then_id_descending(
        self, client: TestClient
    ) -> None:
        response = client.get("/api/dashboard")

        # "Recent activity" is when the work last moved (updated_at), which is
        # also what PATCH /api/tasks/:id advances.
        assert [task["id"] for task in response.json()["recentTasks"]] == [
            101,
            102,
            105,
        ]

    def test_orders_the_projects_by_task_count_descending_then_id_ascending(
        self, client: TestClient
    ) -> None:
        response = client.get("/api/dashboard")

        assert [p["id"] for p in response.json()["projects"]] == [1, 2]
