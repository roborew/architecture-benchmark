# tests/integration/test_tasks_writes.py
#
# The write side of /api/tasks — the forms behind the task pages, including
# the one-transaction create-with-comment and the comment thread. Exercises
# the full HTTP stack through the test client against the seeded test
# database; every refused body must also leave nothing behind.

import pytest

from src.db.connection import Db
from src.tasks.model import PostgresTasksModel, TaskCreateInput, WithCommentInput

CREATE_BODY = {
    "projectId": 1,
    "assigneeId": 2,
    "title": "Audit the navigation copy",
    "description": "Re-read every navigation label against the new IA.",
    "status": "todo",
}


def created_id(response) -> int:
    return int(response.get_json()["redirectTo"].split("/")[2])


class TestCreateTask:
    def test_creates_the_task_and_redirects_to_its_detail_page(self, client):
        response = client.post("/api/tasks", json=CREATE_BODY)

        assert response.status_code == 201
        body = response.get_json()
        assert body["ok"] is True
        assert body["message"] == "Task created."
        assert body["redirectTo"].startswith("/tasks/")

        # A persisted id must have been allocated (spec/contract.md): the
        # redirect target resolves to the committed row.
        task_id = created_id(response)
        detail = client.get(f"/api/tasks/{task_id}")

        assert detail.status_code == 200
        assert detail.get_json()["id"] == task_id
        assert detail.get_json()["projectId"] == 1
        assert detail.get_json()["title"] == "Audit the navigation copy"
        assert detail.get_json()["status"] == "todo"
        assert detail.get_json()["assigneeName"] == "Alex Morgan"

    def test_sets_created_at_and_updated_at_equal_at_insert(self, client):
        created = client.post(
            "/api/tasks", json={**CREATE_BODY, "title": "Timestamp probe"}
        )
        task_id = created_id(created)

        # created_at is only exposed on the board's rows (createdAtRaw, the
        # cursor component) and updated_at on every row: the two must agree
        # to the second, which is the fixture's precision and the display
        # contract.
        board = client.get("/api/projects/1/tasks")
        row = next(task for task in board.get_json() if task["id"] == task_id)

        assert row["createdAtRaw"][:19] == row["updatedAt"][:19]

    def test_creates_an_unassigned_task_when_assignee_id_is_null(self, client):
        response = client.post("/api/tasks", json={**CREATE_BODY, "assigneeId": None})

        detail = client.get(f"/api/tasks/{created_id(response)}")

        assert detail.get_json()["assigneeName"] == "Unassigned"

    def test_reports_the_reference_field_errors_for_an_invalid_body(self, client):
        response = client.post(
            "/api/tasks", json={**CREATE_BODY, "title": "", "status": "bogus"}
        )

        assert response.status_code == 400
        assert response.get_json() == {
            "error": "Missing fields. Failed to create task.",
            "errors": {
                "title": ["Title is required."],
                "status": ["Choose a valid status."],
            },
        }

    def test_reports_an_omitted_title_exactly_as_the_reference_form_does(self, client):
        response = client.post("/api/tasks", json={"projectId": 1, "status": "todo"})

        assert response.status_code == 400
        assert response.get_json() == {
            "error": "Missing fields. Failed to create task.",
            "errors": {"title": ["Invalid input: expected string, received null"]},
        }

    def test_reports_the_reference_choose_a_project_error_for_a_bad_project_id(
        self, client
    ):
        response = client.post("/api/tasks", json={**CREATE_BODY, "projectId": "one"})

        assert response.status_code == 400
        assert response.get_json() == {
            "error": "Missing fields. Failed to create task.",
            "errors": {"projectId": ["Choose a project."]},
        }

    def test_reports_the_reference_existence_errors_for_unknown_refs(self, client):
        project = client.post("/api/tasks", json={**CREATE_BODY, "projectId": 999})

        assert project.status_code == 400
        assert project.get_json() == {
            "error": "Missing fields. Failed to create task.",
            "errors": {"projectId": ["That project no longer exists."]},
        }

        assignee = client.post("/api/tasks", json={**CREATE_BODY, "assigneeId": 999})

        assert assignee.status_code == 400
        assert assignee.get_json() == {
            "error": "Missing fields. Failed to create task.",
            "errors": {"assigneeId": ["That assignee no longer exists."]},
        }

    def test_inserts_nothing_for_a_refused_body(self, client):
        before = client.get("/api/tasks/count")

        client.post("/api/tasks", json={**CREATE_BODY, "projectId": 999})

        after = client.get("/api/tasks/count")

        assert after.get_json()["count"] == before.get_json()["count"]

    def test_answers_a_malformed_json_body_with_the_invalid_json_envelope(self, client):
        response = client.post(
            "/api/tasks", data="{not json", content_type="application/json"
        )

        assert response.status_code == 400
        assert response.get_json() == {"error": "Invalid JSON body"}


class TestUpdateTask:
    def test_updates_the_task_advances_updated_at_and_redirects_to_it(self, client):
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
        assert response.get_json() == {
            "ok": True,
            "message": "Task updated.",
            "redirectTo": "/tasks/102",
        }

        after = client.get("/api/tasks/102")

        assert after.get_json()["id"] == 102
        assert after.get_json()["title"] == "Confirm breakpoint rules (revised)"
        assert (
            after.get_json()["description"]
            == "Agree the breakpoints, including the tablet one."
        )
        assert after.get_json()["status"] == "in progress"
        assert after.get_json()["assigneeName"] == "Robin Andrew"

        # spec/queries.md: the statement must explicitly advance updated_at.
        assert after.get_json()["updatedAt"] != before.get_json()["updatedAt"]
        assert after.get_json()["updatedAt"] > "2026-09-28T11:20:00Z"

    def test_unassigns_the_task_when_assignee_id_is_null(self, client):
        response = client.patch(
            "/api/tasks/102",
            json={
                "title": "Confirm breakpoint rules",
                "description": "Agree the breakpoints the shared layout tokens are generated from.",
                "status": "todo",
                "assigneeId": None,
            },
        )

        assert response.status_code == 200

        after = client.get("/api/tasks/102")

        assert after.get_json()["assigneeName"] == "Unassigned"

    def test_reports_the_reference_field_errors_for_an_invalid_body(self, client):
        response = client.patch(
            "/api/tasks/102", json={"description": "d", "status": "later"}
        )

        assert response.status_code == 400
        assert response.get_json() == {
            "error": "Missing fields. Failed to update task.",
            "errors": {
                "title": ["Invalid input: expected string, received null"],
                "status": ["Choose a valid status."],
            },
        }

    def test_reports_the_reference_assignee_existence_error(self, client):
        response = client.patch(
            "/api/tasks/102",
            json={
                "title": "Confirm breakpoint rules",
                "description": "Agree the breakpoints the shared layout tokens are generated from.",
                "status": "todo",
                "assigneeId": 999,
            },
        )

        assert response.status_code == 400
        assert response.get_json() == {
            "error": "Missing fields. Failed to update task.",
            "errors": {"assigneeId": ["That assignee no longer exists."]},
        }

    def test_returns_the_reference_404_message_for_an_unknown_task(self, client):
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
        assert response.get_json() == {"error": "That task no longer exists."}


class TestDeleteTask:
    def _create_task(self, client, title):
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
        return created_id(created)

    def test_deletes_the_task_and_redirects_to_its_project_board(self, client):
        task_id = self._create_task(client, "Delete me")

        response = client.delete(f"/api/tasks/{task_id}")

        assert response.status_code == 200
        assert response.get_json() == {
            "ok": True,
            "message": "Task deleted.",
            "redirectTo": "/projects/1",
        }

        detail = client.get(f"/api/tasks/{task_id}")

        assert detail.status_code == 404
        assert detail.get_json() == {"error": "Not found"}

    def test_cascades_the_tasks_comments_away_with_it(self, client):
        task_id = self._create_task(client, "Delete me with comments")
        client.post(
            f"/api/tasks/{task_id}/comments", json={"body": "A comment.", "authorId": 1}
        )

        client.delete(f"/api/tasks/{task_id}")

        comments = client.get(f"/api/tasks/{task_id}/comments")

        assert comments.get_json() == []

    def test_returns_the_reference_404_message_for_an_unknown_task(self, client):
        response = client.delete("/api/tasks/999")

        assert response.status_code == 404
        assert response.get_json() == {"error": "That task no longer exists."}


class TestCreateTaskWithComment:
    BODY = {
        "projectId": 1,
        "assigneeId": 1,
        "title": "Publish the navigation copy",
        "description": "Ship the agreed labels.",
        "status": "todo",
        "commentBody": "Copy is finalised and ready to publish.",
        "commentAuthorId": 2,
    }

    def test_creates_the_task_and_its_first_comment_in_one_transaction(self, client):
        response = client.post("/api/tasks/with-comment", json=self.BODY)

        assert response.status_code == 201
        body = response.get_json()
        assert body["ok"] is True
        assert body["redirectTo"].startswith("/tasks/")

        task_id = created_id(response)

        # Both halves of the transaction are visible: the task row, and the
        # one comment it was created with.
        detail = client.get(f"/api/tasks/{task_id}")
        comments = client.get(f"/api/tasks/{task_id}/comments")

        assert detail.get_json()["id"] == task_id
        assert detail.get_json()["commentCount"] == 1
        assert len(comments.get_json()) == 1
        assert comments.get_json()[0]["taskId"] == task_id
        assert comments.get_json()[0]["authorName"] == "Alex Morgan"
        assert (
            comments.get_json()[0]["body"] == "Copy is finalised and ready to publish."
        )

    def test_reports_the_comments_own_field_errors_with_the_tasks_message(self, client):
        response = client.post(
            "/api/tasks/with-comment", json={**self.BODY, "commentBody": ""}
        )

        assert response.status_code == 400
        assert response.get_json() == {
            "error": "Missing fields. Failed to create the task.",
            "errors": {"commentBody": ["Comment is required."]},
        }

    def test_reports_the_reference_author_error_filed_where_it_files_it(self, client):
        response = client.post(
            "/api/tasks/with-comment", json={**self.BODY, "commentAuthorId": 999}
        )

        assert response.status_code == 400
        assert response.get_json() == {
            "error": "Missing fields. Failed to create the task.",
            "errors": {"assigneeId": ["That comment author no longer exists."]},
        }

    def test_rolls_back_the_task_when_the_comment_insert_fails(self, client, e2e_url):
        # The HTTP layer pre-validates everything the schema constrains, so a
        # mid-transaction failure has to be provoked at the model layer — the
        # same rollback path the transaction provides to the endpoint. A body
        # over the CHECK on comments.body passes the endpoint's own checks
        # only when the model is called directly, and the task insert must not
        # survive it.
        model = PostgresTasksModel(Db(e2e_url))

        with pytest.raises(RuntimeError):
            model.create_with_comment(
                WithCommentInput(
                    task=TaskCreateInput(
                        project_id=1,
                        assignee_id=None,
                        title="Must not survive a failed comment",
                        description="",
                        status="todo",
                    ),
                    comment_body="x" * 1001,
                    comment_author_id=1,
                )
            )

        # No partial state: neither the task nor its comment exists.
        search = client.get("/api/tasks?q=Must not survive a failed comment")

        assert search.get_json() == []


class TestAddComment:
    def test_adds_the_comment_and_replies_ok_with_no_redirect(self, client):
        response = client.post(
            "/api/tasks/101/comments",
            json={"body": "A new comment from the integration suite.", "authorId": 3},
        )

        # The reference's createComment returns no redirectTo — the user stays
        # on the detail page — so the reply is the ok marker alone.
        assert response.status_code == 201
        assert response.get_json() == {"ok": True}

        comments = client.get("/api/tasks/101/comments")

        # Newest first: the fresh comment leads the list.
        assert len(comments.get_json()) == 3
        assert comments.get_json()[0]["taskId"] == 101
        assert comments.get_json()[0]["authorName"] == "Sam Taylor"
        assert (
            comments.get_json()[0]["body"]
            == "A new comment from the integration suite."
        )

    def test_never_returns_more_than_the_10_most_recent_comments(self, client):
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
        task_id = created_id(created)

        # Eleven comments: one more than the bound, so a limit honoured only
        # by luck would show all eleven.
        for index in range(11):
            client.post(
                f"/api/tasks/{task_id}/comments",
                json={"body": f"Comment number {index}.", "authorId": 1},
            )

        comments = client.get(f"/api/tasks/{task_id}/comments")

        assert len(comments.get_json()) == 10
        assert comments.get_json()[0]["body"] == "Comment number 10."
        assert comments.get_json()[9]["body"] == "Comment number 1."

    def test_reports_the_reference_field_errors_for_an_empty_body(self, client):
        response = client.post(
            "/api/tasks/101/comments", json={"body": "", "authorId": 1}
        )

        assert response.status_code == 400
        assert response.get_json() == {
            "error": "Missing fields. Failed to add the comment.",
            "errors": {"body": ["Comment is required."]},
        }

    def test_reports_the_reference_author_error(self, client):
        response = client.post(
            "/api/tasks/101/comments", json={"body": "A comment.", "authorId": 999}
        )

        assert response.status_code == 400
        assert response.get_json() == {
            "error": "Missing fields. Failed to add the comment.",
            "errors": {"authorId": ["That comment author no longer exists."]},
        }

    def test_returns_the_reference_404_message_for_an_unknown_task(self, client):
        response = client.post(
            "/api/tasks/999/comments", json={"body": "A comment.", "authorId": 1}
        )

        assert response.status_code == 404
        assert response.get_json() == {"error": "That task no longer exists."}
