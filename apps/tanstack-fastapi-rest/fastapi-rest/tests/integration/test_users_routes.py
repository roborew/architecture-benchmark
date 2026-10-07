"""tests/integration/test_users_routes.py

The /api/users surface — the reads behind the People listing and member
pages, and the writes behind the member forms. Exercises the full HTTP stack
(routes → controller → model → Postgres) through the FastAPI TestClient
against the seeded test database, and asserts the exact rows the shared
fixture produces so a SQL drift is caught here, not in the browser.

The list row shape and ordering mirror the reference variant's getUsers
(display_name DESC, id DESC, the DISTINCT aggregate counts); the member's
tasks mirror getUserTasks (updated_at DESC, id DESC, the shared task
projection).
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration

# The search contract mirrors the reference variant's getUsers integration
# suite (case-insensitive name match, email match, wildcard escaping), with
# the HTTP boundaries the REST layer adds: 400 envelopes for malformed q.

# The seeded fixture (spec/snapshots/correctness), worked through by hand:
#
#   users   1 Robin Andrew, 2 Alex Morgan, 3 Sam Taylor
#   tasks   101, 105 → user 1 (both "in progress")
#           102, 104 → user 2 (both "todo")
#           103     → user 3 ("done"), 106 → user 3 ("todo")
#   comments  1 (author 2), 2 (author 1), 3 (author 2)
#
# Expected rows, in display_name DESC, id DESC order (the getUsers contract):
EXPECTED_USERS = [
    {
        "id": 3,
        "name": "Sam Taylor",
        "email": "sam@example.test",
        "assignedTaskCount": 2,
        "openTaskCount": 1,  # 106 only: 103 is done
        "commentCount": 0,
    },
    {
        "id": 1,
        "name": "Robin Andrew",
        "email": "robin@example.test",
        "assignedTaskCount": 2,
        "openTaskCount": 2,
        "commentCount": 1,
    },
    {
        "id": 2,
        "name": "Alex Morgan",
        "email": "alex@example.test",
        "assignedTaskCount": 2,
        "openTaskCount": 2,
        "commentCount": 2,
    },
]


class TestGetApiUsers:
    def test_returns_200_with_a_json_array(self, client: TestClient) -> None:
        response = client.get("/api/users")

        assert response.status_code == 200
        assert "json" in response.headers["content-type"]
        assert isinstance(response.json(), list)

    def test_returns_exactly_the_seeded_members_and_aggregate_columns(
        self, client: TestClient
    ) -> None:
        response = client.get("/api/users")

        # Full equality (not subset matching): the row shape is the API
        # contract — an extra or missing key is a breaking change for the
        # client that renders it.
        assert response.json() == EXPECTED_USERS

    def test_orders_members_by_display_name_descending_then_id_descending(
        self, client: TestClient
    ) -> None:
        response = client.get("/api/users")

        assert [user["id"] for user in response.json()] == [3, 1, 2]

    def test_counts_the_join_safe_aggregates_the_listing_table_renders(
        self, client: TestClient
    ) -> None:
        response = client.get("/api/users")

        by_email = {user["email"]: user for user in response.json()}

        # The two LEFT JOINs multiply rows (a member with 2 tasks and 2
        # comments produces 4 joined rows), so a non-DISTINCT count would
        # double-report.
        assert by_email["alex@example.test"]["assignedTaskCount"] == 2
        assert by_email["alex@example.test"]["commentCount"] == 2
        # "done" tasks count as assigned but not open.
        assert by_email["sam@example.test"]["assignedTaskCount"] == 2
        assert by_email["sam@example.test"]["openTaskCount"] == 1

    def test_matches_a_member_name_case_insensitively(self, client: TestClient) -> None:
        response = client.get("/api/users", params={"q": "ROBIN"})

        assert len(response.json()) == 1
        assert response.json()[0]["id"] == 1
        assert response.json()[0]["name"] == "Robin Andrew"

    def test_matches_on_email_as_well_as_name(self, client: TestClient) -> None:
        response = client.get("/api/users", params={"q": "alex@example.test"})

        assert len(response.json()) == 1
        assert response.json()[0]["id"] == 2

    def test_returns_an_empty_array_for_a_term_that_matches_no_member(
        self, client: TestClient
    ) -> None:
        response = client.get("/api/users", params={"q": "no-such-person"})

        assert response.status_code == 200
        assert response.json() == []

    def test_treats_like_wildcards_in_the_term_as_literal_characters(
        self, client: TestClient
    ) -> None:
        # A bare `%` would otherwise match every row and hide a real escaping
        # bug.
        percent = client.get("/api/users", params={"q": "%"})
        underscore = client.get("/api/users", params={"q": "_"})

        assert percent.json() == []
        assert underscore.json() == []

    def test_ignores_surrounding_whitespace(self, client: TestClient) -> None:
        response = client.get("/api/users", params={"q": "  Robin Andrew  "})

        assert len(response.json()) == 1
        assert response.json()[0]["id"] == 1

    def test_returns_400_when_q_is_repeated(self, client: TestClient) -> None:
        response = client.get("/api/users", params={"q": ["robin", "sam"]})

        assert response.status_code == 400
        assert response.json() == {"error": "q must be a single value"}

    def test_returns_400_when_q_is_longer_than_100_characters(
        self, client: TestClient
    ) -> None:
        response = client.get("/api/users", params={"q": "a" * 101})

        assert response.status_code == 400
        assert response.json() == {"error": "q must be at most 100 characters"}


class TestGetApiUserById:
    def test_returns_exactly_the_member_row_with_the_same_aggregates_as_the_list(
        self, client: TestClient
    ) -> None:
        response = client.get("/api/users/1")

        assert response.status_code == 200
        assert response.json() == {
            "id": 1,
            "name": "Robin Andrew",
            "email": "robin@example.test",
            "assignedTaskCount": 2,
            "openTaskCount": 2,
            "commentCount": 1,
        }

    def test_returns_the_plain_404_envelope_for_an_unknown_id(
        self, client: TestClient
    ) -> None:
        response = client.get("/api/users/999")

        assert response.status_code == 404
        assert response.json() == {"error": "Not found"}

    def test_returns_400_for_an_id_that_cannot_name_a_row(
        self, client: TestClient
    ) -> None:
        response = client.get("/api/users/abc")

        assert response.status_code == 400
        assert response.json() == {"error": "id must be a positive integer"}


class TestGetApiUserTasks:
    def test_returns_the_members_tasks_newest_updated_first_with_project_names(
        self, client: TestClient
    ) -> None:
        response = client.get("/api/users/3/tasks")

        assert response.status_code == 200
        assert response.json() == [
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
            },
            {
                "id": 106,
                "projectId": 3,
                "projectName": "Platform migration",
                "title": "Write migration checklist",
                "description": (
                    "List the steps and owners for moving to the new platform."
                ),
                "status": "todo",
                "assigneeName": "Sam Taylor",
                "commentCount": 0,
                "updatedAt": "2026-09-23T11:20:00Z",
            },
        ]

    def test_scopes_by_assignee_id_not_by_display_name(
        self, client: TestClient
    ) -> None:
        # Two members can share a display name (users.display_name has no
        # UNIQUE constraint); a name filter would hand each of them the
        # other's work. Here the scope is simply id 1's own two tasks.
        response = client.get("/api/users/1/tasks")

        assert [task["id"] for task in response.json()] == [101, 105]

    def test_returns_an_empty_list_for_a_member_with_no_tasks(
        self, client: TestClient
    ) -> None:
        response = client.get("/api/users/999/tasks")

        assert response.status_code == 200
        assert response.json() == []


class TestPostApiUsers:
    def test_creates_the_member_and_redirects_to_their_page(
        self, client: TestClient
    ) -> None:
        response = client.post(
            "/api/users", json={"name": "New Person", "email": "new@example.test"}
        )

        assert response.status_code == 201
        assert response.json() == {
            "ok": True,
            "message": "User created.",
            "redirectTo": "/users/4",
        }

        detail = client.get("/api/users/4")

        assert detail.status_code == 200
        assert detail.json()["id"] == 4
        assert detail.json()["name"] == "New Person"
        assert detail.json()["email"] == "new@example.test"

    def test_reports_the_references_field_errors_for_an_invalid_body(
        self, client: TestClient
    ) -> None:
        response = client.post(
            "/api/users", json={"name": "Bad Email", "email": "not-an-address"}
        )

        assert response.status_code == 400
        assert response.json() == {
            "error": "Missing fields. Failed to create user.",
            "errors": {"email": ["Enter a valid email address."]},
        }

    def test_reports_an_omitted_name_exactly_as_the_references_form_does(
        self, client: TestClient
    ) -> None:
        response = client.post("/api/users", json={"email": "new@example.test"})

        assert response.status_code == 400
        assert response.json() == {
            "error": "Missing fields. Failed to create user.",
            "errors": {"name": ["Invalid input: expected string, received null"]},
        }


class TestPatchApiUser:
    def test_updates_the_member_and_redirects_to_their_page(
        self, client: TestClient
    ) -> None:
        response = client.patch(
            "/api/users/1",
            json={
                "name": "Robin Andrew (contractor)",
                "email": "robin@example.test",
            },
        )

        assert response.status_code == 200
        assert response.json() == {
            "ok": True,
            "message": "User updated.",
            "redirectTo": "/users/1",
        }

        detail = client.get("/api/users/1")

        assert detail.json()["id"] == 1
        assert detail.json()["name"] == "Robin Andrew (contractor)"

    def test_returns_the_references_404_message_for_an_unknown_member(
        self, client: TestClient
    ) -> None:
        response = client.patch(
            "/api/users/999",
            json={"name": "No such", "email": "nobody@example.test"},
        )

        assert response.status_code == 404
        assert response.json() == {"error": "That user no longer exists."}


class TestDeleteApiUser:
    def test_deletes_a_member_with_no_comments_unassigning_their_tasks(
        self, client: TestClient
    ) -> None:
        # Sam (3) has no comments but two tasks; tasks.assignee_id is ON
        # DELETE SET NULL, so the delete succeeds and unassigns rather than
        # blocking.
        response = client.delete("/api/users/3")

        assert response.status_code == 200
        assert response.json() == {
            "ok": True,
            "message": "User deleted.",
            "redirectTo": "/users",
        }

        detail = client.get("/api/users/3")

        assert detail.status_code == 404

        # The tasks survive, unassigned.
        task103 = client.get("/api/tasks/103")

        assert task103.json()["id"] == 103
        assert task103.json()["assigneeName"] == "Unassigned"

    def test_refuses_a_member_who_authored_comments_with_the_references_guard(
        self, client: TestClient
    ) -> None:
        # Alex (2) wrote two comments and has two tasks; the comment count is
        # what blocks the delete (RESTRICT), the task count is context (SET
        # NULL).
        response = client.delete("/api/users/2")

        assert response.status_code == 409
        assert response.json() == {
            "error": (
                "This person still has 2 comments and 2 tasks. "
                "Remove the comments before deleting."
            ),
        }

        # The refused delete changed nothing.
        detail = client.get("/api/users/2")

        assert detail.status_code == 200

    def test_returns_the_references_404_message_for_an_unknown_member(
        self, client: TestClient
    ) -> None:
        response = client.delete("/api/users/999")

        assert response.status_code == 404
        assert response.json() == {"error": "That user no longer exists."}
