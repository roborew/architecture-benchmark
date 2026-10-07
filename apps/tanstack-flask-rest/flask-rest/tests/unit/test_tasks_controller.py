# tests/unit/test_tasks_controller.py
#
# The controller's HTTP contract with the model stubbed: what it sends to the
# model, what (status, payload) it decides on, and which HttpError it raises
# for each refused outcome. No database, no Flask — the controller takes
# plain values.

import pytest

from src.lib.http_error import HttpError
from src.tasks.controller import TasksController

CREATE_BODY = {
    "projectId": 1,
    "assigneeId": 2,
    "title": "Audit the navigation copy",
    "description": "Re-read every navigation label against the new IA.",
    "status": "todo",
}

UPDATE_BODY = {
    "title": "Confirm breakpoint rules",
    "description": "Agree the breakpoints.",
    "status": "in progress",
    "assigneeId": 1,
}


class FakeTasksModel:
    def __init__(self, **results):
        self.calls = []
        self.results = results

    def list(self, filters):
        self.calls.append(("list", filters))
        return self.results.get("list", [])

    def count(self, filters):
        self.calls.append(("count", filters))
        return self.results.get("count", 0)

    def get(self, id):
        self.calls.append(("get", id))
        return self.results.get("get")

    def list_by_project(self, project_id, filters):
        self.calls.append(("list_by_project", project_id, filters))
        return self.results.get("list_by_project", [])

    def list_by_assignee(self, assignee_id):
        self.calls.append(("list_by_assignee", assignee_id))
        return self.results.get("list_by_assignee", [])

    def list_comments(self, task_id):
        self.calls.append(("list_comments", task_id))
        return self.results.get("list_comments", [])

    def resolve_refs(self, project_id, assignee_id):
        self.calls.append(("resolve_refs", project_id, assignee_id))
        return self.results.get("resolve_refs", {})

    def create(self, input):
        self.calls.append(("create", input))
        return self.results.get("create", 107)

    def update(self, id, input):
        self.calls.append(("update", id, input))
        return self.results.get("update", "ok")

    def remove(self, id):
        self.calls.append(("remove", id))
        return self.results.get("remove", 1)

    def create_with_comment(self, input):
        self.calls.append(("create_with_comment", input))
        return self.results.get("create_with_comment", 107)

    def add_comment(self, task_id, body, author_id):
        self.calls.append(("add_comment", task_id, body, author_id))
        return self.results.get("add_comment", "ok")


class TestList:
    def test_passes_the_parsed_filters_to_the_model(self):
        model = FakeTasksModel(list=[{"id": 101}])
        status, payload = TasksController(model).list(
            {"q": ["navigation"], "status": ["todo"], "limit": ["10"]}
        )

        assert (status, payload) == (200, [{"id": 101}])
        filters = model.calls[0][1]
        assert filters.search == "navigation"
        assert filters.status == "todo"
        assert filters.limit == 10

    def test_raises_the_400_envelope_for_an_unknown_status(self):
        model = FakeTasksModel()

        with pytest.raises(HttpError) as raised:
            TasksController(model).list({"status": ["bogus"]})

        assert raised.value.payload == {"error": "Unknown task status: bogus"}
        assert model.calls == []


class TestCount:
    def test_responds_with_the_count_envelope(self):
        model = FakeTasksModel(count=6)
        status, payload = TasksController(model).count({})

        assert (status, payload) == (200, {"count": 6})


class TestGet:
    def test_responds_200_with_the_models_row(self):
        model = FakeTasksModel(get={"id": 101})
        status, payload = TasksController(model).get("101")

        assert model.calls == [("get", 101)]
        assert (status, payload) == (200, {"id": 101})

    def test_raises_the_plain_404_envelope_when_the_row_is_missing(self):
        model = FakeTasksModel(get=None)

        with pytest.raises(HttpError) as raised:
            TasksController(model).get("999")

        assert raised.value.payload == {"error": "Not found"}


class TestCreate:
    def test_responds_201_with_the_success_envelope_pointing_at_the_new_row(self):
        model = FakeTasksModel(create=107)
        status, payload = TasksController(model).create(CREATE_BODY)

        assert (status, payload) == (
            201,
            {"ok": True, "message": "Task created.", "redirectTo": "/tasks/107"},
        )
        sent = next(call[1] for call in model.calls if call[0] == "create")
        assert (sent.project_id, sent.assignee_id, sent.title) == (
            1,
            2,
            "Audit the navigation copy",
        )

    def test_raises_the_reference_field_errors_for_an_invalid_body(self):
        model = FakeTasksModel()

        with pytest.raises(HttpError) as raised:
            TasksController(model).create(
                {**CREATE_BODY, "title": "", "status": "bogus"}
            )

        assert raised.value.payload == {
            "error": "Missing fields. Failed to create task.",
            "errors": {
                "title": ["Title is required."],
                "status": ["Choose a valid status."],
            },
        }
        assert model.calls == []

    def test_wraps_the_models_existence_errors_in_the_same_envelope(self):
        model = FakeTasksModel(
            resolve_refs={"projectId": ["That project no longer exists."]}
        )

        with pytest.raises(HttpError) as raised:
            TasksController(model).create({**CREATE_BODY, "projectId": 999})

        assert raised.value.payload == {
            "error": "Missing fields. Failed to create task.",
            "errors": {"projectId": ["That project no longer exists."]},
        }
        # The shape check passed, so the model was asked about the row — but
        # nothing was written.
        assert [c[0] for c in model.calls] == ["resolve_refs"]


class TestCreateWithComment:
    def test_responds_201_pointing_at_the_new_row(self):
        model = FakeTasksModel(create_with_comment=108)
        body = {
            **CREATE_BODY,
            "commentBody": "Copy is finalised.",
            "commentAuthorId": 2,
        }
        status, payload = TasksController(model).create_with_comment(body)

        assert (status, payload) == (
            201,
            {"ok": True, "message": "Task created.", "redirectTo": "/tasks/108"},
        )
        sent = next(call[1] for call in model.calls if call[0] == "create_with_comment")
        assert sent.comment_body == "Copy is finalised."
        assert sent.comment_author_id == 2

    def test_raises_the_comment_fields_own_errors(self):
        model = FakeTasksModel()

        with pytest.raises(HttpError) as raised:
            TasksController(model).create_with_comment(
                {**CREATE_BODY, "commentBody": "", "commentAuthorId": 2}
            )

        assert raised.value.payload == {
            "error": "Missing fields. Failed to create the task.",
            "errors": {"commentBody": ["Comment is required."]},
        }

    def test_files_the_author_error_where_the_reference_files_it(self):
        model = FakeTasksModel(create_with_comment="author-missing")

        with pytest.raises(HttpError) as raised:
            TasksController(model).create_with_comment(
                {**CREATE_BODY, "commentBody": "A note.", "commentAuthorId": 999}
            )

        assert raised.value.payload == {
            "error": "Missing fields. Failed to create the task.",
            "errors": {"assigneeId": ["That comment author no longer exists."]},
        }


class TestUpdate:
    def test_responds_200_with_the_success_envelope(self):
        model = FakeTasksModel(update="ok")
        status, payload = TasksController(model).update("102", UPDATE_BODY)

        assert (status, payload) == (
            200,
            {"ok": True, "message": "Task updated.", "redirectTo": "/tasks/102"},
        )
        sent = model.calls[0][2]
        assert (sent.title, sent.status, sent.assignee_id) == (
            "Confirm breakpoint rules",
            "in progress",
            1,
        )

    def test_raises_the_assignee_existence_error(self):
        model = FakeTasksModel(update="assignee-missing")

        with pytest.raises(HttpError) as raised:
            TasksController(model).update("102", {**UPDATE_BODY, "assigneeId": 999})

        assert raised.value.payload == {
            "error": "Missing fields. Failed to update task.",
            "errors": {"assigneeId": ["That assignee no longer exists."]},
        }

    def test_raises_the_reference_404_message_for_a_missing_row(self):
        model = FakeTasksModel(update="missing")

        with pytest.raises(HttpError) as raised:
            TasksController(model).update("999", UPDATE_BODY)

        assert raised.value.payload == {"error": "That task no longer exists."}


class TestRemove:
    def test_responds_200_redirecting_to_the_deleted_tasks_project_board(self):
        model = FakeTasksModel(remove=1)
        status, payload = TasksController(model).remove("102")

        assert (status, payload) == (
            200,
            {"ok": True, "message": "Task deleted.", "redirectTo": "/projects/1"},
        )

    def test_raises_the_reference_404_message_for_a_missing_row(self):
        model = FakeTasksModel(remove=None)

        with pytest.raises(HttpError) as raised:
            TasksController(model).remove("999")

        assert raised.value.payload == {"error": "That task no longer exists."}


class TestAddComment:
    def test_responds_201_with_the_ok_marker_alone(self):
        # The reference's createComment returns no redirectTo — the user stays
        # on the detail page — so `ok: true` is the whole reply.
        model = FakeTasksModel(add_comment="ok")
        status, payload = TasksController(model).add_comment(
            "101", {"body": "A note.", "authorId": 1}
        )

        assert model.calls == [("add_comment", 101, "A note.", 1)]
        assert (status, payload) == (201, {"ok": True})

    def test_raises_the_reference_404_message_for_a_missing_task(self):
        model = FakeTasksModel(add_comment="task-missing")

        with pytest.raises(HttpError) as raised:
            TasksController(model).add_comment(
                "999", {"body": "A note.", "authorId": 1}
            )

        assert raised.value.payload == {"error": "That task no longer exists."}

    def test_raises_the_author_existence_error(self):
        model = FakeTasksModel(add_comment="author-missing")

        with pytest.raises(HttpError) as raised:
            TasksController(model).add_comment(
                "101", {"body": "A note.", "authorId": 999}
            )

        assert raised.value.payload == {
            "error": "Missing fields. Failed to add the comment.",
            "errors": {"authorId": ["That comment author no longer exists."]},
        }
