"""tests/unit/test_tasks_controller.py

The controller's HTTP contract with the model stubbed: what it sends to the
model, what it returns to the routes (the route fixes the 2xx status), and
which ApiError it raises for each refused outcome (the exception handlers map
the raise to the same JSON envelope the old direct writes produced). No
database, no TestClient — the model is a fake.
"""

from __future__ import annotations

import asyncio

import pytest

from app.lib.http_error import ApiError
from app.tasks.controller import TasksController
from app.tasks.schemas import TaskRow
from app.tasks.validator import TaskListFilters


class AsyncStub:
    """One model method as the Express tests' vi.fn(): records every call it
    receives, then returns the preset result (or raises the preset error)."""

    def __init__(self, result: object = None, error: Exception | None = None) -> None:
        self.result = result
        self.error = error
        self.calls: list[tuple] = []

    async def __call__(self, *args: object) -> object:
        self.calls.append(args)
        if self.error is not None:
            raise self.error
        return self.result


def make_model(**overrides: AsyncStub) -> object:
    """The TasksModel seam as a bag of async stubs (the Express makeModel)."""
    model = type("StubTasksModel", (), {})()
    for name in (
        "list",
        "count",
        "get",
        "list_by_project",
        "list_by_assignee",
        "list_comments",
        "resolve_refs",
        "create",
        "update",
        "remove",
        "create_with_comment",
        "add_comment",
    ):
        setattr(model, name, AsyncStub())
    for name, stub in overrides.items():
        setattr(model, name, stub)
    return model


TASK = TaskRow(
    id=101,
    project_id=1,
    project_name="Unit Project",
    title="Unit task",
    description="A task from the unit fixture.",
    status="todo",
    assignee_name="Unit Person",
    comment_count=0,
    updated_at="2026-09-29T08:00:00Z",
    updated_at_raw="2026-09-29T08:00:00.000000Z",
    cursor_for="cursor",
)


class TestList:
    def test_responds_with_the_models_rows_as_json(self) -> None:
        # The 200 is the route's; the controller's half of the contract is
        # the rows themselves, passed through untouched.
        model = make_model(list=AsyncStub(result=[TASK]))

        rows = asyncio.run(TasksController(model).list({}))

        assert rows == [TASK]

    def test_passes_the_parsed_filters_to_the_model(self) -> None:
        model = make_model(list=AsyncStub(result=[]))

        asyncio.run(
            TasksController(model).list({"q": "  navigation  ", "status": " todo "})
        )

        assert model.list.calls == [
            (TaskListFilters(search="navigation", status="todo"),)
        ]

    def test_rejects_when_the_model_rejects_so_the_error_handlers_take_over(
        self,
    ) -> None:
        model = make_model(list=AsyncStub(error=RuntimeError("db down")))

        # Express 5 treats a rejected async handler as next(err); here the
        # raise simply propagates out of the coroutine — the controller must
        # not swallow it into a bogus 200.
        with pytest.raises(RuntimeError, match="db down"):
            asyncio.run(TasksController(model).list({}))

    def test_throws_the_400_apierror_envelope_when_q_is_an_array(self) -> None:
        model = make_model(list=AsyncStub(result=[]))

        with pytest.raises(ApiError) as excinfo:
            asyncio.run(
                TasksController(model).list({"q": ["navigation", "breakpoint"]})
            )

        assert excinfo.value.status == 400
        assert excinfo.value.payload == {"error": "q must be a single value"}

        # No query may run for a request the API refused (and the raise is
        # the whole reply — nothing else is ever written).
        assert model.list.calls == []

    def test_throws_the_references_status_message_for_an_unknown_status(self) -> None:
        model = make_model(list=AsyncStub(result=[]))

        with pytest.raises(ApiError) as excinfo:
            asyncio.run(TasksController(model).list({"status": "bogus"}))

        assert excinfo.value.status == 400
        assert excinfo.value.payload == {"error": "Unknown task status: bogus"}

        assert model.list.calls == []

    def test_throws_400_for_a_non_integer_filter_id(self) -> None:
        model = make_model()

        with pytest.raises(ApiError) as excinfo:
            asyncio.run(TasksController(model).list({"projectId": "one"}))

        assert excinfo.value.status == 400
        assert excinfo.value.payload == {"error": "projectId must be an integer"}


class TestCount:
    def test_responds_with_the_models_count(self) -> None:
        model = make_model(count=AsyncStub(result=6))

        result = asyncio.run(TasksController(model).count({}))

        assert result.model_dump() == {"count": 6}

    def test_shares_the_lists_filters(self) -> None:
        model = make_model(count=AsyncStub(result=0))

        asyncio.run(TasksController(model).count({"q": "nav", "status": "done"}))

        assert model.count.calls == [(TaskListFilters(search="nav", status="done"),)]


class TestGet:
    def test_responds_with_the_models_row(self) -> None:
        model = make_model(get=AsyncStub(result=TASK))

        row = asyncio.run(TasksController(model).get("101"))

        assert model.get.calls == [(101,)]
        assert row == TASK

    def test_throws_the_plain_404_envelope_when_the_row_is_missing(self) -> None:
        model = make_model(get=AsyncStub(result=None))

        with pytest.raises(ApiError) as excinfo:
            asyncio.run(TasksController(model).get("999"))

        assert excinfo.value.status == 404
        assert excinfo.value.payload == {"error": "Not found"}

    def test_throws_400_for_a_non_integer_id(self) -> None:
        model = make_model()

        with pytest.raises(ApiError) as excinfo:
            asyncio.run(TasksController(model).get("abc"))

        assert excinfo.value.status == 400
        assert excinfo.value.payload == {"error": "id must be a positive integer"}


class TestCreate:
    BODY = {
        "projectId": 1,
        "assigneeId": 2,
        "title": "Unit task",
        "description": "A task from the unit fixture.",
        "status": "todo",
    }

    def test_responds_with_the_success_envelope_pointing_at_the_new_row(
        self,
    ) -> None:
        model = make_model(
            resolve_refs=AsyncStub(result={}),
            create=AsyncStub(result=101),
        )

        result = asyncio.run(TasksController(model).create(self.BODY))

        (input,) = model.create.calls[0]
        assert input.project_id == 1
        assert input.assignee_id == 2
        assert input.title == "Unit task"
        assert input.description == "A task from the unit fixture."
        assert input.status == "todo"
        assert result.model_dump(by_alias=True, exclude_none=True) == {
            "ok": True,
            "message": "Task created.",
            "redirectTo": "/tasks/101",
        }

    def test_throws_the_references_field_error_envelope_for_a_bad_body(
        self,
    ) -> None:
        model = make_model()

        with pytest.raises(ApiError) as excinfo:
            asyncio.run(
                TasksController(model).create(
                    {"projectId": 1, "title": "", "status": "todo"}
                )
            )

        assert excinfo.value.status == 400
        assert excinfo.value.payload == {
            "error": "Missing fields. Failed to create task.",
            "errors": {"title": ["Title is required."]},
        }

        # Nothing may be written for a body the API refused.
        assert model.resolve_refs.calls == []
        assert model.create.calls == []

    def test_throws_the_choose_a_project_error_for_an_unresolvable_project_id(
        self,
    ) -> None:
        model = make_model()

        with pytest.raises(ApiError) as excinfo:
            asyncio.run(
                TasksController(model).create({**self.BODY, "projectId": "one"})
            )

        assert excinfo.value.status == 400
        assert excinfo.value.payload == {
            "error": "Missing fields. Failed to create task.",
            "errors": {"projectId": ["Choose a project."]},
        }

    def test_throws_the_references_existence_error_when_resolve_refs_misses(
        self,
    ) -> None:
        model = make_model(
            resolve_refs=AsyncStub(
                result={"assigneeId": ["That assignee no longer exists."]}
            )
        )

        with pytest.raises(ApiError) as excinfo:
            asyncio.run(TasksController(model).create({**self.BODY, "assigneeId": 999}))

        assert excinfo.value.status == 400
        assert excinfo.value.payload == {
            "error": "Missing fields. Failed to create task.",
            "errors": {"assigneeId": ["That assignee no longer exists."]},
        }

        assert model.create.calls == []


class TestUpdate:
    BODY = {
        "title": "Renamed",
        "description": "d",
        "status": "done",
        "assigneeId": None,
    }

    def test_responds_with_the_success_envelope_pointing_at_the_row(self) -> None:
        model = make_model(update=AsyncStub(result="ok"))

        result = asyncio.run(TasksController(model).update("101", self.BODY))

        # assigneeId: null is the explicit "unassigned" choice, not an
        # omission.
        (task_id, input) = model.update.calls[0]
        assert task_id == 101
        assert input.title == "Renamed"
        assert input.description == "d"
        assert input.status == "done"
        assert input.assignee_id is None
        assert result.model_dump(by_alias=True, exclude_none=True) == {
            "ok": True,
            "message": "Task updated.",
            "redirectTo": "/tasks/101",
        }

    def test_throws_the_references_404_message_for_a_missing_row(self) -> None:
        model = make_model(update=AsyncStub(result="missing"))

        with pytest.raises(ApiError) as excinfo:
            asyncio.run(TasksController(model).update("999", self.BODY))

        assert excinfo.value.status == 404
        assert excinfo.value.payload == {"error": "That task no longer exists."}

    def test_throws_the_assignee_field_error_when_the_assignee_is_gone(self) -> None:
        model = make_model(update=AsyncStub(result="assignee-missing"))

        with pytest.raises(ApiError) as excinfo:
            asyncio.run(
                TasksController(model).update("101", {**self.BODY, "assigneeId": 999})
            )

        assert excinfo.value.status == 400
        assert excinfo.value.payload == {
            "error": "Missing fields. Failed to update task.",
            "errors": {"assigneeId": ["That assignee no longer exists."]},
        }


class TestRemove:
    def test_responds_with_the_redirect_to_the_deleted_tasks_board(self) -> None:
        model = make_model(remove=AsyncStub(result=1))

        result = asyncio.run(TasksController(model).remove("101"))

        assert result.model_dump(by_alias=True, exclude_none=True) == {
            "ok": True,
            "message": "Task deleted.",
            "redirectTo": "/projects/1",
        }

    def test_throws_the_references_404_message_for_a_missing_row(self) -> None:
        model = make_model(remove=AsyncStub(result=None))

        with pytest.raises(ApiError) as excinfo:
            asyncio.run(TasksController(model).remove("999"))

        assert excinfo.value.status == 404
        assert excinfo.value.payload == {"error": "That task no longer exists."}


class TestAddComment:
    def test_responds_with_ok_only_the_references_createcomment_has_no_redirect(
        self,
    ) -> None:
        model = make_model(add_comment=AsyncStub(result="ok"))

        result = asyncio.run(
            TasksController(model).add_comment(
                "101", {"body": "A note.", "authorId": 1}
            )
        )

        assert model.add_comment.calls == [(101, "A note.", 1)]
        assert result.model_dump(by_alias=True, exclude_none=True) == {"ok": True}

    def test_throws_the_references_404_message_when_the_task_is_gone(self) -> None:
        model = make_model(add_comment=AsyncStub(result="task-missing"))

        with pytest.raises(ApiError) as excinfo:
            asyncio.run(
                TasksController(model).add_comment(
                    "999", {"body": "A note.", "authorId": 1}
                )
            )

        assert excinfo.value.status == 404
        assert excinfo.value.payload == {"error": "That task no longer exists."}

    def test_throws_the_author_field_error_when_the_author_is_gone(self) -> None:
        model = make_model(add_comment=AsyncStub(result="author-missing"))

        with pytest.raises(ApiError) as excinfo:
            asyncio.run(
                TasksController(model).add_comment(
                    "101", {"body": "A note.", "authorId": 999}
                )
            )

        assert excinfo.value.status == 400
        assert excinfo.value.payload == {
            "error": "Missing fields. Failed to add the comment.",
            "errors": {"authorId": ["That comment author no longer exists."]},
        }

    def test_throws_the_comment_field_error_for_an_empty_body(self) -> None:
        model = make_model()

        with pytest.raises(ApiError) as excinfo:
            asyncio.run(
                TasksController(model).add_comment("101", {"body": "", "authorId": 1})
            )

        assert excinfo.value.status == 400
        assert excinfo.value.payload == {
            "error": "Missing fields. Failed to add the comment.",
            "errors": {"body": ["Comment is required."]},
        }

        assert model.add_comment.calls == []


class TestCreateWithComment:
    BODY = {
        "projectId": 1,
        "assigneeId": None,
        "title": "Unit task",
        "description": "",
        "status": "todo",
        "commentBody": "First comment.",
        "commentAuthorId": 2,
    }

    def test_responds_with_the_success_envelope_pointing_at_the_new_row(
        self,
    ) -> None:
        model = make_model(
            resolve_refs=AsyncStub(result={}),
            create_with_comment=AsyncStub(result=("ok", 107)),
        )

        result = asyncio.run(TasksController(model).create_with_comment(self.BODY))

        (input,) = model.create_with_comment.calls[0]
        assert input.project_id == 1
        assert input.assignee_id is None
        assert input.title == "Unit task"
        assert input.description == ""
        assert input.status == "todo"
        assert input.comment_body == "First comment."
        assert input.comment_author_id == 2
        assert result.model_dump(by_alias=True, exclude_none=True) == {
            "ok": True,
            "message": "Task created.",
            "redirectTo": "/tasks/107",
        }

    def test_throws_the_comments_own_field_errors_with_the_tasks_message(
        self,
    ) -> None:
        model = make_model()

        with pytest.raises(ApiError) as excinfo:
            asyncio.run(
                TasksController(model).create_with_comment(
                    {**self.BODY, "commentBody": ""}
                )
            )

        assert excinfo.value.status == 400
        assert excinfo.value.payload == {
            "error": "Missing fields. Failed to create the task.",
            "errors": {"commentBody": ["Comment is required."]},
        }

    def test_throws_the_references_author_error_filed_under_assignee_id_as_it_files_it(
        self,
    ) -> None:
        model = make_model(
            resolve_refs=AsyncStub(result={}),
            create_with_comment=AsyncStub(result=("author-missing", 0)),
        )

        with pytest.raises(ApiError) as excinfo:
            asyncio.run(TasksController(model).create_with_comment(self.BODY))

        assert excinfo.value.status == 400
        assert excinfo.value.payload == {
            "error": "Missing fields. Failed to create the task.",
            "errors": {"assigneeId": ["That comment author no longer exists."]},
        }
