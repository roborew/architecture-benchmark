"""tests/integration/test_projects_routes.py

The /api/projects surface — the reads behind the project listing and board
pages, and the writes behind the project forms. Exercises the full HTTP
stack (routes → controller → model → Postgres) through the FastAPI TestClient
against the seeded test database, and asserts the exact rows the shared
fixture produces so a SQL drift is caught here, not in the browser.

The row shapes and orderings mirror the reference variant (getProjects,
getProject, getProjectTasks), including the board's keyset paging over
`(created_at, id)`.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.lib.cursor import encode_cursor

pytestmark = pytest.mark.integration

# The seeded fixture (spec/snapshots/correctness), worked through by hand:
#
#   projects 1 Website redesign (created 09-27), 2 Mobile application (09-21),
#            3 Platform migration (09-12)
#   tasks     101, 102, 103 → project 1; 104, 105 → project 2; 106 → project 3
#
# Expected rows, in created_at DESC, id DESC order (the getProjects contract):
EXPECTED_PROJECTS = [
    {
        "id": 1,
        "name": "Website redesign",
        "description": "Refresh the public website and onboarding experience.",
        "taskCount": 3,
        "openTaskCount": 2,  # 101 in progress, 102 todo; 103 is done
        "peopleCount": 3,  # assignees 1, 2 and 3
        "createdAt": "2026-09-27",
    },
    {
        "id": 2,
        "name": "Mobile application",
        "description": "Ship the first mobile experience for existing workspace members.",
        "taskCount": 2,
        "openTaskCount": 2,  # 104 todo, 105 in progress
        "peopleCount": 2,  # assignees 1 and 2
        "createdAt": "2026-09-21",
    },
    {
        "id": 3,
        "name": "Platform migration",
        "description": "Move the service and supporting processes to the new platform.",
        "taskCount": 1,
        "openTaskCount": 1,  # 106 todo
        "peopleCount": 1,  # assignee 3
        "createdAt": "2026-09-12",
    },
]


def _with_cursor(task: dict) -> dict:
    return {
        **task,
        "cursorFor": encode_cursor(task["createdAtRaw"], task["id"]),
    }


# Project 1's board, in created_at DESC, id DESC order (getProjectTasks):
PROJECT_1_TASKS = [
    _with_cursor(task)
    for task in [
        {
            "id": 101,
            "projectId": 1,
            "projectName": "Website redesign",
            "title": "Draft navigation model",
            "description": (
                "Map the navigation structure for the public and authenticated product areas."
            ),
            "status": "in progress",
            "assigneeName": "Robin Andrew",
            "commentCount": 2,
            "updatedAt": "2026-09-29T08:00:00Z",
            "createdAtRaw": "2026-09-28T10:15:00.000000Z",
        },
        {
            "id": 102,
            "projectId": 1,
            "projectName": "Website redesign",
            "title": "Confirm breakpoint rules",
            "description": (
                "Agree the breakpoints the shared layout tokens are generated from."
            ),
            "status": "todo",
            "assigneeName": "Alex Morgan",
            "commentCount": 0,
            "updatedAt": "2026-09-28T11:20:00Z",
            "createdAtRaw": "2026-09-27T14:30:00.000000Z",
        },
        {
            "id": 103,
            "projectId": 1,
            "projectName": "Website redesign",
            "title": "Prepare content inventory",
            "description": (
                "Collect the copy and imagery currently live across the public pages."
            ),
            "status": "done",
            "assigneeName": "Sam Taylor",
            "commentCount": 0,
            "updatedAt": "2026-09-27T16:45:00Z",
            "createdAtRaw": "2026-09-26T09:05:00.000000Z",
        },
    ]
]


class TestGetApiProjects:
    def test_returns_200_with_a_json_array(self, client: TestClient) -> None:
        response = client.get("/api/projects")

        assert response.status_code == 200
        assert "json" in response.headers["content-type"]
        assert isinstance(response.json(), list)

    def test_returns_exactly_the_seeded_projects_and_aggregate_columns(
        self, client: TestClient
    ) -> None:
        response = client.get("/api/projects")

        # Full equality (not subset matching): the row shape is the API
        # contract — an extra or missing key is a breaking change for the
        # client that renders it.
        assert response.json() == EXPECTED_PROJECTS

    def test_orders_projects_by_created_at_descending_then_id_descending(
        self, client: TestClient
    ) -> None:
        response = client.get("/api/projects")

        assert [project["id"] for project in response.json()] == [1, 2, 3]

    def test_matches_a_project_name_case_insensitively(
        self, client: TestClient
    ) -> None:
        response = client.get("/api/projects", params={"q": "REDESIGN"})

        assert len(response.json()) == 1
        assert response.json()[0]["id"] == 1
        assert response.json()[0]["name"] == "Website redesign"

    def test_matches_on_description_as_well_as_name(self, client: TestClient) -> None:
        # "platform" appears in project 3's description and its name;
        # "onboarding" only in project 1's description.
        platform = client.get("/api/projects", params={"q": "platform"})
        onboarding = client.get("/api/projects", params={"q": "onboarding"})

        assert [p["id"] for p in platform.json()] == [3]
        assert [p["id"] for p in onboarding.json()] == [1]

    def test_treats_like_wildcards_in_the_term_as_literal_characters(
        self, client: TestClient
    ) -> None:
        percent = client.get("/api/projects", params={"q": "%"})
        underscore = client.get("/api/projects", params={"q": "_"})

        assert percent.json() == []
        assert underscore.json() == []

    def test_returns_400_when_q_is_repeated(self, client: TestClient) -> None:
        response = client.get("/api/projects", params={"q": ["redesign", "migration"]})

        assert response.status_code == 400
        assert response.json() == {"error": "q must be a single value"}


class TestGetApiProjectById:
    def test_returns_exactly_the_project_row(self, client: TestClient) -> None:
        response = client.get("/api/projects/2")

        assert response.status_code == 200
        assert response.json() == EXPECTED_PROJECTS[1]

    def test_returns_the_plain_404_envelope_for_an_unknown_id(
        self, client: TestClient
    ) -> None:
        response = client.get("/api/projects/999")

        assert response.status_code == 404
        assert response.json() == {"error": "Not found"}

    def test_returns_400_for_an_id_that_cannot_name_a_row(
        self, client: TestClient
    ) -> None:
        response = client.get("/api/projects/abc")

        assert response.status_code == 400
        assert response.json() == {"error": "id must be a positive integer"}


class TestGetApiProjectTasks:
    def test_returns_the_boards_rows_with_their_cursor_fields(
        self, client: TestClient
    ) -> None:
        response = client.get("/api/projects/1/tasks")

        assert response.status_code == 200
        assert response.json() == PROJECT_1_TASKS

    def test_orders_the_board_by_created_at_descending_then_id_descending(
        self, client: TestClient
    ) -> None:
        response = client.get("/api/projects/1/tasks")

        assert [task["id"] for task in response.json()] == [101, 102, 103]

    def test_returns_an_empty_board_for_an_unknown_project(
        self, client: TestClient
    ) -> None:
        # Mirror getProjectTasks: the board of a project that has no tasks —
        # or that no longer exists — is empty, not an error.
        response = client.get("/api/projects/999/tasks")

        assert response.status_code == 200
        assert response.json() == []

    def test_filters_the_board_by_status(self, client: TestClient) -> None:
        todo = client.get("/api/projects/1/tasks", params={"status": "todo"})
        done = client.get("/api/projects/1/tasks", params={"status": "done"})

        assert [task["id"] for task in todo.json()] == [102]
        assert [task["id"] for task in done.json()] == [103]

    def test_returns_400_with_the_references_message_for_an_unknown_status(
        self, client: TestClient
    ) -> None:
        response = client.get("/api/projects/1/tasks", params={"status": "shipped"})

        assert response.status_code == 400
        assert response.json() == {"error": "Unknown task status: shipped"}

    def test_pages_the_board_by_keyset_over_created_at_and_id(
        self, client: TestClient
    ) -> None:
        first = client.get("/api/projects/1/tasks", params={"limit": "2"})

        assert [task["id"] for task in first.json()] == [101, 102]

        # The last row's cursorFor is the (created_at, id) tuple the next page
        # starts after.
        cursor = first.json()[1]["cursorFor"]
        second = client.get(
            "/api/projects/1/tasks", params={"limit": "2", "cursor": cursor}
        )

        assert [task["id"] for task in second.json()] == [103]

    def test_is_stable_and_repeatable_the_same_cursor_yields_the_same_page(
        self, client: TestClient
    ) -> None:
        first = client.get("/api/projects/1/tasks", params={"limit": "1"})
        cursor = first.json()[0]["cursorFor"]
        params = {"limit": "2", "cursor": cursor}

        second = client.get("/api/projects/1/tasks", params=params)
        third = client.get("/api/projects/1/tasks", params=params)

        # spec/queries.md: the cursor "must be stable and repeatable".
        assert second.json() == third.json()
        assert [task["id"] for task in second.json()] == [102, 103]

    def test_keeps_the_status_filter_while_paging(self, client: TestClient) -> None:
        first = client.get(
            "/api/projects/1/tasks", params={"status": "todo", "limit": "1"}
        )

        assert [task["id"] for task in first.json()] == [102]

        # The cursor must not silently reset the filter: the next page is the
        # NEXT TODO TASK, not the next task.
        cursor = first.json()[0]["cursorFor"]
        second = client.get(
            "/api/projects/1/tasks",
            params={"status": "todo", "limit": "1", "cursor": cursor},
        )

        assert second.json() == []

    def test_reads_the_first_page_for_a_cursor_nothing_could_have_produced(
        self, client: TestClient
    ) -> None:
        response = client.get("/api/projects/1/tasks", params={"cursor": "!!!!"})

        assert response.status_code == 200
        assert [task["id"] for task in response.json()] == [101, 102, 103]

    def test_clamps_the_limit_to_1_26_like_the_reference(
        self, client: TestClient
    ) -> None:
        zero = client.get("/api/projects/1/tasks", params={"limit": "0"})

        assert len(zero.json()) == 1

        huge = client.get("/api/projects/1/tasks", params={"limit": "99"})

        # Three tasks in the project: the ceiling only shows once the fixture
        # outgrows it.
        assert len(huge.json()) == 3

    def test_returns_400_for_a_non_integer_limit(self, client: TestClient) -> None:
        response = client.get("/api/projects/1/tasks", params={"limit": "many"})

        assert response.status_code == 400
        assert response.json() == {"error": "limit must be an integer"}


class TestPostApiProjects:
    def test_creates_the_project_and_redirects_to_its_board(
        self, client: TestClient
    ) -> None:
        response = client.post(
            "/api/projects",
            json={
                "name": "Accessibility audit",
                "description": "Audit every surface against WCAG AA.",
            },
        )

        assert response.status_code == 201
        assert response.json() == {
            "ok": True,
            "message": "Project created.",
            "redirectTo": "/projects/4",
        }

        # A persisted id must have been allocated: the redirect target
        # resolves to the committed row, with a fresh project's empty
        # aggregates.
        detail = client.get("/api/projects/4")

        assert detail.status_code == 200
        assert detail.json() == {
            "id": 4,
            "name": "Accessibility audit",
            "description": "Audit every surface against WCAG AA.",
            "taskCount": 0,
            "openTaskCount": 0,
            "peopleCount": 0,
            "createdAt": datetime.now(timezone.utc).date().isoformat(),
        }

    def test_reports_the_references_field_errors_for_an_empty_name(
        self, client: TestClient
    ) -> None:
        response = client.post("/api/projects", json={"name": "", "description": "d"})

        assert response.status_code == 400
        assert response.json() == {
            "error": "Missing fields. Failed to create project.",
            "errors": {"name": ["Project name is required."]},
        }

    def test_requires_a_description_exactly_as_the_references_schema_does(
        self, client: TestClient
    ) -> None:
        response = client.post("/api/projects", json={"name": "No description"})

        assert response.status_code == 400
        assert response.json() == {
            "error": "Missing fields. Failed to create project.",
            "errors": {
                "description": ["Invalid input: expected string, received null"],
            },
        }


class TestPatchApiProject:
    def test_updates_the_project_and_redirects_to_it(self, client: TestClient) -> None:
        response = client.patch(
            "/api/projects/2",
            json={
                "name": "Mobile application (v2)",
                "description": "Ship the second mobile experience.",
            },
        )

        assert response.status_code == 200
        assert response.json() == {
            "ok": True,
            "message": "Project updated.",
            "redirectTo": "/projects/2",
        }

        detail = client.get("/api/projects/2")

        assert detail.json()["id"] == 2
        assert detail.json()["name"] == "Mobile application (v2)"
        assert detail.json()["description"] == "Ship the second mobile experience."
        # The aggregates survive an edit of the descriptive fields.
        assert detail.json()["taskCount"] == 2

    def test_reports_the_references_field_errors_for_a_too_long_name(
        self, client: TestClient
    ) -> None:
        response = client.patch(
            "/api/projects/2",
            json={"name": "a" * 201, "description": "d"},
        )

        assert response.status_code == 400
        assert response.json() == {
            "error": "Missing fields. Failed to update project.",
            "errors": {"name": ["Project name must be 200 characters or fewer."]},
        }

    def test_returns_the_references_404_message_for_an_unknown_project(
        self, client: TestClient
    ) -> None:
        response = client.patch(
            "/api/projects/999", json={"name": "No such", "description": "d"}
        )

        assert response.status_code == 404
        assert response.json() == {"error": "That project no longer exists."}


class TestDeleteApiProject:
    def test_deletes_an_empty_project_and_redirects_to_the_listing(
        self, client: TestClient
    ) -> None:
        created = client.post(
            "/api/projects",
            json={"name": "Short-lived project", "description": "d"},
        )
        id = created.json()["redirectTo"].split("/")[2]

        response = client.delete(f"/api/projects/{id}")

        assert response.status_code == 200
        assert response.json() == {
            "ok": True,
            "message": "Project deleted.",
            "redirectTo": "/projects",
        }

        detail = client.get(f"/api/projects/{id}")

        assert detail.status_code == 404
        assert detail.json() == {"error": "Not found"}

    def test_refuses_a_project_that_still_has_tasks_with_the_references_guard(
        self, client: TestClient
    ) -> None:
        singular = client.delete("/api/projects/3")

        assert singular.status_code == 409
        assert singular.json() == {
            "error": (
                "This project still has 1 task. Delete it before deleting the project."
            ),
        }

        plural = client.delete("/api/projects/1")

        assert plural.status_code == 409
        assert plural.json() == {
            "error": (
                "This project still has 3 tasks. "
                "Delete them before deleting the project."
            ),
        }

        # The refused delete changed nothing.
        detail = client.get("/api/projects/1")

        assert detail.status_code == 200

    def test_returns_the_references_404_message_for_an_unknown_project(
        self, client: TestClient
    ) -> None:
        response = client.delete("/api/projects/999")

        assert response.status_code == 404
        assert response.json() == {"error": "That project no longer exists."}
