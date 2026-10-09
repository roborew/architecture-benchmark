"""tests/unit/test_projects_controller.py

The controller's HTTP contract with the model stubbed: what it sends to the
model, what it returns to the routes (the route fixes the 2xx status), and
which ApiError it raises for each refused outcome (the exception handlers map
the raise to its JSON envelope). No database, no TestClient — the model is a
fake.
"""

from __future__ import annotations

import asyncio

import pytest

from app.lib.http_error import ApiError
from app.projects.controller import ProjectsController
from app.projects.schemas import Project
from app.tasks.schemas import ProjectTaskRow
from app.tasks.validator import ProjectTaskFilters


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
    """The ProjectsModel seam as a bag of async stubs (the Express makeModel)."""
    model = type("StubProjectsModel", (), {})()
    for name in ("list", "get", "list_tasks", "create", "update", "remove"):
        setattr(model, name, AsyncStub())
    for name, stub in overrides.items():
        setattr(model, name, stub)
    return model


PROJECT = Project(
    id=1,
    name="Unit Project",
    description="A project from the unit fixture.",
    task_count=0,
    open_task_count=0,
    people_count=0,
    created_at="2026-09-27",
)


class TestList:
    def test_responds_with_the_models_rows_as_json(self) -> None:
        # The 200 is the route's; the controller's half of the contract is
        # the rows themselves, passed through untouched.
        model = make_model(list=AsyncStub(result=[PROJECT]))

        rows = asyncio.run(ProjectsController(model).list({}))

        assert rows == [PROJECT]

    def test_passes_a_trimmed_q_to_the_model(self) -> None:
        model = make_model(list=AsyncStub(result=[]))

        asyncio.run(ProjectsController(model).list({"q": "  redesign  "}))

        assert model.list.calls == [("redesign",)]

    def test_throws_the_400_apierror_envelope_when_q_is_an_array(self) -> None:
        model = make_model(list=AsyncStub(result=[]))

        with pytest.raises(ApiError) as excinfo:
            asyncio.run(ProjectsController(model).list({"q": ["a", "b"]}))

        assert excinfo.value.status == 400
        assert excinfo.value.payload == {"error": "q must be a single value"}

        # No query may run for a request the API refused (and the raise is
        # the whole reply — nothing else is ever written).
        assert model.list.calls == []


class TestGet:
    def test_responds_with_the_models_row(self) -> None:
        model = make_model(get=AsyncStub(result=PROJECT))

        row = asyncio.run(ProjectsController(model).get("1"))

        assert model.get.calls == [(1,)]
        assert row == PROJECT

    def test_throws_the_plain_404_envelope_when_the_row_is_missing(self) -> None:
        model = make_model(get=AsyncStub(result=None))

        with pytest.raises(ApiError) as excinfo:
            asyncio.run(ProjectsController(model).get("999"))

        assert excinfo.value.status == 404
        assert excinfo.value.payload == {"error": "Not found"}


class TestListTasks:
    def test_passes_the_route_id_and_the_parsed_filters_to_the_model(self) -> None:
        task = ProjectTaskRow(
            id=101,
            project_id=1,
            project_name="Unit Project",
            title="Unit task",
            description="",
            status="todo",
            assignee_name="Unit Person",
            comment_count=0,
            updated_at="2026-09-29T08:00:00Z",
            created_at_raw="2026-09-28T10:15:00.000000Z",
            cursor_for="cursor",
        )
        model = make_model(list_tasks=AsyncStub(result=[task]))

        rows = asyncio.run(
            ProjectsController(model).list_tasks("1", {"status": "todo", "limit": "2"})
        )

        assert model.list_tasks.calls == [
            (1, ProjectTaskFilters(status="todo", cursor=None, limit=2))
        ]
        assert rows == [task]

    def test_throws_the_references_status_message_for_an_unknown_status(
        self,
    ) -> None:
        model = make_model()

        with pytest.raises(ApiError) as excinfo:
            asyncio.run(ProjectsController(model).list_tasks("1", {"status": "bogus"}))

        assert excinfo.value.status == 400
        assert excinfo.value.payload == {"error": "Unknown task status: bogus"}

        assert model.list_tasks.calls == []


class TestCreate:
    def test_responds_with_the_success_envelope_pointing_at_the_new_row(
        self,
    ) -> None:
        model = make_model(create=AsyncStub(result=4))

        result = asyncio.run(
            ProjectsController(model).create(
                {"name": "New project", "description": "d"}
            )
        )

        (input,) = model.create.calls[0]
        assert input.name == "New project"
        assert input.description == "d"
        assert result.model_dump(by_alias=True, exclude_none=True) == {
            "ok": True,
            "message": "Project created.",
            "redirectTo": "/projects/4",
        }

    def test_throws_the_references_field_error_envelope_for_an_empty_name(
        self,
    ) -> None:
        model = make_model()

        with pytest.raises(ApiError) as excinfo:
            asyncio.run(
                ProjectsController(model).create({"name": "", "description": "d"})
            )

        assert excinfo.value.status == 400
        assert excinfo.value.payload == {
            "error": "Missing fields. Failed to create project.",
            "errors": {"name": ["Project name is required."]},
        }

        assert model.create.calls == []


class TestUpdate:
    def test_responds_with_the_success_envelope_pointing_at_the_row(self) -> None:
        model = make_model(update=AsyncStub(result="ok"))

        result = asyncio.run(
            ProjectsController(model).update(
                "1", {"name": "Renamed", "description": "d"}
            )
        )

        assert result.model_dump(by_alias=True, exclude_none=True) == {
            "ok": True,
            "message": "Project updated.",
            "redirectTo": "/projects/1",
        }

    def test_throws_the_references_404_message_for_a_missing_row(self) -> None:
        model = make_model(update=AsyncStub(result="missing"))

        with pytest.raises(ApiError) as excinfo:
            asyncio.run(
                ProjectsController(model).update(
                    "999", {"name": "Renamed", "description": "d"}
                )
            )

        assert excinfo.value.status == 404
        assert excinfo.value.payload == {"error": "That project no longer exists."}


class TestRemove:
    def test_responds_with_the_redirect_to_the_projects_listing(self) -> None:
        model = make_model(remove=AsyncStub(result=("ok", "")))

        result = asyncio.run(ProjectsController(model).remove("3"))

        assert result.model_dump(by_alias=True, exclude_none=True) == {
            "ok": True,
            "message": "Project deleted.",
            "redirectTo": "/projects",
        }

    def test_throws_the_references_404_message_for_a_missing_row(self) -> None:
        model = make_model(remove=AsyncStub(result=("missing", "")))

        with pytest.raises(ApiError) as excinfo:
            asyncio.run(ProjectsController(model).remove("999"))

        assert excinfo.value.status == 404
        assert excinfo.value.payload == {"error": "That project no longer exists."}

    def test_throws_the_409_guard_message_while_the_project_still_has_tasks(
        self,
    ) -> None:
        model = make_model(
            remove=AsyncStub(
                result=(
                    "restricted",
                    "This project still has 1 task. "
                    "Delete it before deleting the project.",
                )
            )
        )

        with pytest.raises(ApiError) as excinfo:
            asyncio.run(ProjectsController(model).remove("1"))

        assert excinfo.value.status == 409
        assert excinfo.value.payload == {
            "error": "This project still has 1 task. "
            "Delete it before deleting the project."
        }
