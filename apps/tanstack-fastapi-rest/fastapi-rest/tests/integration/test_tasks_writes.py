"""tests/integration/test_tasks_writes.py

The write surface behind the task forms: POST/PATCH/DELETE /api/tasks, the
transactional POST /api/tasks/with-comment, and POST /api/tasks/:id/comments.
Exercises the full HTTP stack (routes → controller → model → Postgres)
through the FastAPI TestClient against the seeded test database, and asserts
the exact envelopes the reference variant's actions produce (message strings
verbatim, field errors keyed by body field, FK guards) plus the committed
state a mutation must leave behind.

The writes run after the reads in this file, and the file is self-contained:
the suite's setup re-seeds the database per module, so the reads above always
start from the fixture.
"""

from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient

from app.db.connection import create_pool
from app.tasks.model import WithCommentInput, create_tasks_model
from tests.helpers.database import e2e_connection_string

pytestmark = pytest.mark.integration

CREATE_BODY = {
    "projectId": 1,
    "assigneeId": 2,
    "title": "Audit the navigation copy",
    "description": "Re-read every navigation label against the new IA.",
    "status": "todo",
}


class TestPostApiTasks:
    def test_creates_the_task_and_redirects_to_its_detail_page(
        self, client: TestClient
    ) -> None:
        response = client.post("/api/tasks", json=CREATE_BODY)

        assert response.status_code == 201
        assert response.json()["ok"] is True
        assert response.json()["message"] == "Task created."
        assert response.json()["redirectTo"].startswith("/tasks/")
        assert response.json()["redirectTo"][7:].isdigit()

        # A persisted id must have been allocated (spec/contract.md): the
        # redirect target resolves to the committed row.
        id = int(response.json()["redirectTo"].split("/")[2])
        detail = client.get(f"/api/tasks/{id}")

        assert detail.status_code == 200
        assert detail.json()["id"] == id
        assert detail.json()["projectId"] == 1
        assert detail.json()["title"] == "Audit the navigation copy"
        assert detail.json()["status"] == "todo"
        assert detail.json()["assigneeName"] == "Alex Morgan"

    def test_sets_created_at_and_updated_at_equal_at_insert(
        self, client: TestClient
    ) -> None:
        created = client.post(
            "/api/tasks", json={**CREATE_BODY, "title": "Timestamp probe"}
        )
        id = int(created.json()["redirectTo"].split("/")[2])

        # created_at is only exposed on the board's rows (createdAtRaw, the
        # cursor component) and updated_at on every row: the two must agree to
        # the second, which is the fixture's precision and the display
        # contract.
        board = client.get("/api/projects/1/tasks")
        row = next(task for task in board.json() if task["id"] == id)

        assert row["createdAtRaw"][:19] == row["updatedAt"][:19]

    def test_creates_an_unassigned_task_when_assignee_id_is_null(
        self, client: TestClient
    ) -> None:
        response = client.post("/api/tasks", json={**CREATE_BODY, "assigneeId": None})

        id = int(response.json()["redirectTo"].split("/")[2])
        detail = client.get(f"/api/tasks/{id}")

        assert detail.json()["assigneeName"] == "Unassigned"

    def test_reports_the_references_field_errors_for_an_invalid_body(
        self, client: TestClient
    ) -> None:
        response = client.post(
            "/api/tasks", json={**CREATE_BODY, "title": "", "status": "bogus"}
        )

        assert response.status_code == 400
        assert response.json() == {
            "error": "Missing fields. Failed to create task.",
            "errors": {
                "title": ["Title is required."],
                "status": ["Choose a valid status."],
            },
        }

    def test_reports_an_omitted_title_exactly_as_the_references_form_does(
        self, client: TestClient
    ) -> None:
        response = client.post("/api/tasks", json={"projectId": 1, "status": "todo"})

        assert response.status_code == 400
        assert response.json() == {
            "error": "Missing fields. Failed to create task.",
            "errors": {"title": ["Invalid input: expected string, received null"]},
        }

    def test_reports_the_references_choose_a_project_error_for_a_bad_project_id(
        self, client: TestClient
    ) -> None:
        response = client.post("/api/tasks", json={**CREATE_BODY, "projectId": "one"})

        assert response.status_code == 400
        assert response.json() == {
            "error": "Missing fields. Failed to create task.",
            "errors": {"projectId": ["Choose a project."]},
        }

    def test_reports_the_references_existence_errors_for_unknown_project_or_assignee(
        self, client: TestClient
    ) -> None:
        project = client.post("/api/tasks", json={**CREATE_BODY, "projectId": 999})

        assert project.status_code == 400
        assert project.json() == {
            "error": "Missing fields. Failed to create task.",
            "errors": {"projectId": ["That project no longer exists."]},
        }

        assignee = client.post("/api/tasks", json={**CREATE_BODY, "assigneeId": 999})

        assert assignee.status_code == 400
        assert assignee.json() == {
            "error": "Missing fields. Failed to create task.",
            "errors": {"assigneeId": ["That assignee no longer exists."]},
        }

    def test_inserts_nothing_for_a_refused_body(self, client: TestClient) -> None:
        before = client.get("/api/tasks/count")

        client.post("/api/tasks", json={**CREATE_BODY, "projectId": 999})

        after = client.get("/api/tasks/count")

        assert after.json()["count"] == before.json()["count"]


class TestPatchApiTask:
    def test_updates_the_task_advances_updated_at_and_redirects_to_it(
        self, client: TestClient
    ) -> None:
        before = client.get("/api/tasks/102")

        response = client.patch(
            "/api/tasks/102",
            json={
                "title": "Confirm breakpoint rules (revised)",
                "description": "Agree the breakpoints, including the tablet one.",
                "status": "in progress",
                "assigneeId": 1,
            },
        )

        assert response.status_code == 200
        assert response.json() == {
            "ok": True,
            "message": "Task updated.",
            "redirectTo": "/tasks/102",
        }

        after = client.get("/api/tasks/102")

        assert after.json()["id"] == 102
        assert after.json()["title"] == "Confirm breakpoint rules (revised)"
        assert (
            after.json()["description"]
            == "Agree the breakpoints, including the tablet one."
        )
        assert after.json()["status"] == "in progress"
        assert after.json()["assigneeName"] == "Robin Andrew"

        # spec/queries.md: the statement must explicitly advance updated_at.
        assert after.json()["updatedAt"] != before.json()["updatedAt"]
        assert after.json()["updatedAt"] > "2026-09-28T11:20:00Z"

    def test_unassigns_the_task_when_assignee_id_is_null(
        self, client: TestClient
    ) -> None:
        response = client.patch(
            "/api/tasks/102",
            json={
                "title": "Confirm breakpoint rules",
                "description": (
                    "Agree the breakpoints the shared layout tokens are generated from."
                ),
                "status": "todo",
                "assigneeId": None,
            },
        )

        assert response.status_code == 200

        after = client.get("/api/tasks/102")

        assert after.json()["assigneeName"] == "Unassigned"

    def test_reports_the_references_field_errors_for_an_invalid_body(
        self, client: TestClient
    ) -> None:
        response = client.patch(
            "/api/tasks/102",
            json={"description": "d", "status": "later"},
        )

        assert response.status_code == 400
        assert response.json() == {
            "error": "Missing fields. Failed to update task.",
            "errors": {
                "title": ["Invalid input: expected string, received null"],
                "status": ["Choose a valid status."],
            },
        }

    def test_reports_the_references_assignee_existence_error(
        self, client: TestClient
    ) -> None:
        response = client.patch(
            "/api/tasks/102",
            json={
                "title": "Confirm breakpoint rules",
                "description": (
                    "Agree the breakpoints the shared layout tokens are generated from."
                ),
                "status": "todo",
                "assigneeId": 999,
            },
        )

        assert response.status_code == 400
        assert response.json() == {
            "error": "Missing fields. Failed to update task.",
            "errors": {"assigneeId": ["That assignee no longer exists."]},
        }

    def test_returns_the_references_404_message_for_an_unknown_task(
        self, client: TestClient
    ) -> None:
        response = client.patch(
            "/api/tasks/999",
            json={
                "title": "No such task",
                "description": "",
                "status": "todo",
                "assigneeId": None,
            },
        )

        assert response.status_code == 404
        assert response.json() == {"error": "That task no longer exists."}


class TestDeleteApiTask:
    def _create_task(self, client: TestClient, title: str) -> int:
        created = client.post(
            "/api/tasks",
            json={
                "projectId": 1,
                "assigneeId": None,
                "title": title,
                "description": "A task the delete tests own.",
                "status": "todo",
            },
        )

        return int(created.json()["redirectTo"].split("/")[2])

    def test_deletes_the_task_and_redirects_to_its_project_board(
        self, client: TestClient
    ) -> None:
        id = self._create_task(client, "Delete me")

        response = client.delete(f"/api/tasks/{id}")

        assert response.status_code == 200
        assert response.json() == {
            "ok": True,
            "message": "Task deleted.",
            "redirectTo": "/projects/1",
        }

        # The committed absence: not in the list, not-found on direct
        # navigation.
        detail = client.get(f"/api/tasks/{id}")

        assert detail.status_code == 404
        assert detail.json() == {"error": "Not found"}

    def test_cascades_the_tasks_comments_away_with_it(self, client: TestClient) -> None:
        id = self._create_task(client, "Delete me with my comments")

        client.post(
            f"/api/tasks/{id}/comments",
            json={
                "body": "A comment that must not outlive its task.",
                "authorId": 1,
            },
        )

        client.delete(f"/api/tasks/{id}")

        comments = client.get(f"/api/tasks/{id}/comments")

        # Mirror getComments: a query scoped to a task that no longer exists
        # returns its (empty) comment list, not an error.
        assert comments.status_code == 200
        assert comments.json() == []

    def test_returns_the_references_404_message_for_an_unknown_task(
        self, client: TestClient
    ) -> None:
        response = client.delete("/api/tasks/999")

        assert response.status_code == 404
        assert response.json() == {"error": "That task no longer exists."}


class TestPostApiTasksWithComment:
    BODY = {
        "projectId": 1,
        "assigneeId": 1,
        "title": "Publish the navigation copy",
        "description": "Ship the agreed labels.",
        "status": "todo",
        "commentBody": "Copy is finalised and ready to publish.",
        "commentAuthorId": 2,
    }

    def test_creates_the_task_and_its_first_comment_in_one_transaction(
        self, client: TestClient
    ) -> None:
        response = client.post("/api/tasks/with-comment", json=self.BODY)

        assert response.status_code == 201
        assert response.json()["ok"] is True
        assert response.json()["redirectTo"].startswith("/tasks/")
        assert response.json()["redirectTo"][7:].isdigit()

        id = int(response.json()["redirectTo"].split("/")[2])

        # Both halves of the transaction are visible: the task row, and the
        # one comment it was created with.
        detail = client.get(f"/api/tasks/{id}")
        comments = client.get(f"/api/tasks/{id}/comments")

        assert detail.json()["id"] == id
        assert detail.json()["commentCount"] == 1
        assert len(comments.json()) == 1
        assert comments.json()[0]["taskId"] == id
        assert comments.json()[0]["authorName"] == "Alex Morgan"
        assert comments.json()[0]["body"] == "Copy is finalised and ready to publish."

    def test_reports_the_comments_own_field_errors_with_the_tasks_message(
        self, client: TestClient
    ) -> None:
        response = client.post(
            "/api/tasks/with-comment", json={**self.BODY, "commentBody": ""}
        )

        assert response.status_code == 400
        assert response.json() == {
            "error": "Missing fields. Failed to create the task.",
            "errors": {"commentBody": ["Comment is required."]},
        }

    def test_reports_the_references_author_error_filed_where_the_reference_files_it(
        self, client: TestClient
    ) -> None:
        response = client.post(
            "/api/tasks/with-comment", json={**self.BODY, "commentAuthorId": 999}
        )

        assert response.status_code == 400
        assert response.json() == {
            "error": "Missing fields. Failed to create the task.",
            "errors": {"assigneeId": ["That comment author no longer exists."]},
        }

    def test_rolls_back_the_task_when_the_comment_insert_fails(
        self, client: TestClient
    ) -> None:
        # The HTTP layer pre-validates everything the schema constrains, so a
        # mid-transaction failure has to be provoked at the model layer — the
        # same rollback path the transaction provides to the endpoint. A body
        # over the CHECK on comments.body passes the endpoint's own checks
        # only when the model is called directly, and the task insert must not
        # survive it.
        async def provoke() -> None:
            pool = create_pool(e2e_connection_string())
            await pool.open()
            try:
                model = create_tasks_model(pool)
                await model.create_with_comment(
                    WithCommentInput(
                        project_id=1,
                        assignee_id=None,
                        title="Must not survive a failed comment",
                        description="",
                        status="todo",
                        comment_body="x" * 1001,
                        comment_author_id=1,
                    )
                )
            finally:
                await pool.close()

        with pytest.raises(Exception):
            asyncio.run(provoke())

        # No partial state: neither the task nor its comment exists.
        search = client.get(
            "/api/tasks", params={"q": "Must not survive a failed comment"}
        )

        assert search.json() == []


class TestPostApiTaskComments:
    def test_adds_the_comment_and_replies_ok_with_no_redirect_like_the_reference(
        self, client: TestClient
    ) -> None:
        response = client.post(
            "/api/tasks/101/comments",
            json={
                "body": "A new comment from the integration suite.",
                "authorId": 3,
            },
        )

        # The reference's createComment returns no redirectTo — the user stays
        # on the detail page — so the reply is the ok marker alone.
        assert response.status_code == 201
        assert response.json() == {"ok": True}

        comments = client.get("/api/tasks/101/comments")

        # Newest first: the fresh comment leads the list.
        assert len(comments.json()) == 3
        assert comments.json()[0]["taskId"] == 101
        assert comments.json()[0]["authorName"] == "Sam Taylor"
        assert comments.json()[0]["body"] == "A new comment from the integration suite."

    def test_never_returns_more_than_the_10_most_recent_comments(
        self, client: TestClient
    ) -> None:
        created = client.post(
            "/api/tasks",
            json={
                "projectId": 2,
                "assigneeId": None,
                "title": "Comment volume probe",
                "description": "",
                "status": "todo",
            },
        )
        id = int(created.json()["redirectTo"].split("/")[2])

        # Eleven comments: one more than the bound, so a limit honoured only
        # by luck would show all eleven.
        for index in range(11):
            client.post(
                f"/api/tasks/{id}/comments",
                json={"body": f"Comment number {index}.", "authorId": 1},
            )

        comments = client.get(f"/api/tasks/{id}/comments")

        assert len(comments.json()) == 10
        assert comments.json()[0]["body"] == "Comment number 10."
        assert comments.json()[9]["body"] == "Comment number 1."

    def test_reports_the_references_field_errors_for_an_empty_body(
        self, client: TestClient
    ) -> None:
        response = client.post(
            "/api/tasks/101/comments", json={"body": "", "authorId": 1}
        )

        assert response.status_code == 400
        assert response.json() == {
            "error": "Missing fields. Failed to add the comment.",
            "errors": {"body": ["Comment is required."]},
        }

    def test_reports_the_references_author_error(self, client: TestClient) -> None:
        response = client.post(
            "/api/tasks/101/comments",
            json={"body": "A comment.", "authorId": 999},
        )

        assert response.status_code == 400
        assert response.json() == {
            "error": "Missing fields. Failed to add the comment.",
            "errors": {"authorId": ["That comment author no longer exists."]},
        }

    def test_returns_the_references_404_message_for_an_unknown_task(
        self, client: TestClient
    ) -> None:
        response = client.post(
            "/api/tasks/999/comments",
            json={"body": "A comment.", "authorId": 1},
        )

        assert response.status_code == 404
        assert response.json() == {"error": "That task no longer exists."}
