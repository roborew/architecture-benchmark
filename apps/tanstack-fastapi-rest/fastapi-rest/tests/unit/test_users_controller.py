"""tests/unit/test_users_controller.py

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
from app.tasks.schemas import Task
from app.users.controller import UsersController
from app.users.schemas import User


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
    """The UsersModel seam as a bag of async stubs (the Express makeModel)."""
    model = type("StubUsersModel", (), {})()
    for name in ("list", "get", "list_tasks", "create", "update", "remove"):
        setattr(model, name, AsyncStub())
    for name, stub in overrides.items():
        setattr(model, name, stub)
    return model


USER = User(
    id=1,
    name="Unit Person",
    email="unit@example.test",
    assigned_task_count=0,
    open_task_count=0,
    comment_count=0,
)


class TestList:
    def test_responds_with_the_models_rows_as_json(self) -> None:
        # The 200 is the route's; the controller's half of the contract is
        # the rows themselves, passed through untouched.
        model = make_model(list=AsyncStub(result=[USER]))

        rows = asyncio.run(UsersController(model).list({}))

        assert rows == [USER]

    def test_passes_a_trimmed_q_to_the_model(self) -> None:
        model = make_model(list=AsyncStub(result=[]))

        asyncio.run(UsersController(model).list({"q": "  robin  "}))

        assert model.list.calls == [("robin",)]

    def test_rejects_when_the_model_rejects_so_the_error_handlers_take_over(
        self,
    ) -> None:
        model = make_model(list=AsyncStub(error=RuntimeError("db down")))

        # Express 5 treats a rejected async handler as next(err); here the
        # raise simply propagates out of the coroutine — the controller must
        # not swallow it into a bogus 200.
        with pytest.raises(RuntimeError, match="db down"):
            asyncio.run(UsersController(model).list({}))

    def test_throws_the_400_apierror_envelope_when_q_is_an_array(self) -> None:
        model = make_model(list=AsyncStub(result=[]))

        with pytest.raises(ApiError) as excinfo:
            asyncio.run(UsersController(model).list({"q": ["robin", "sam"]}))

        assert excinfo.value.status == 400
        assert excinfo.value.payload == {"error": "q must be a single value"}

        # No query may run for a request the API refused (and the raise is
        # the whole reply — nothing else is ever written).
        assert model.list.calls == []

    def test_throws_400_when_q_exceeds_100_characters(self) -> None:
        model = make_model(list=AsyncStub(result=[]))

        with pytest.raises(ApiError) as excinfo:
            asyncio.run(UsersController(model).list({"q": "a" * 101}))

        assert excinfo.value.status == 400
        assert excinfo.value.payload == {"error": "q must be at most 100 characters"}

        assert model.list.calls == []

    def test_passes_a_100_character_q_through_as_valid(self) -> None:
        model = make_model(list=AsyncStub(result=[]))

        asyncio.run(UsersController(model).list({"q": "a" * 100}))

        assert model.list.calls == [("a" * 100,)]


class TestGet:
    def test_responds_with_the_models_row(self) -> None:
        model = make_model(get=AsyncStub(result=USER))

        row = asyncio.run(UsersController(model).get("1"))

        assert model.get.calls == [(1,)]
        assert row == USER

    def test_throws_the_plain_404_envelope_when_the_row_is_missing(self) -> None:
        model = make_model(get=AsyncStub(result=None))

        with pytest.raises(ApiError) as excinfo:
            asyncio.run(UsersController(model).get("999"))

        assert excinfo.value.status == 404
        assert excinfo.value.payload == {"error": "Not found"}


class TestListTasks:
    def test_responds_with_the_models_rows_scoped_by_the_route_id(self) -> None:
        task = Task(
            id=101,
            project_id=1,
            project_name="Unit Project",
            title="Unit task",
            description="",
            status="todo",
            assignee_name="Unit Person",
            comment_count=0,
            updated_at="2026-09-29T08:00:00Z",
        )
        model = make_model(list_tasks=AsyncStub(result=[task]))

        rows = asyncio.run(UsersController(model).list_tasks("1"))

        assert model.list_tasks.calls == [(1,)]
        assert rows == [task]


class TestCreate:
    def test_responds_with_the_success_envelope_pointing_at_the_new_row(
        self,
    ) -> None:
        model = make_model(create=AsyncStub(result=4))

        result = asyncio.run(
            UsersController(model).create(
                {"name": "New Person", "email": "new@example.test"}
            )
        )

        (input,) = model.create.calls[0]
        assert input.name == "New Person"
        assert input.email == "new@example.test"
        assert result.model_dump(by_alias=True, exclude_none=True) == {
            "ok": True,
            "message": "User created.",
            "redirectTo": "/users/4",
        }

    def test_throws_the_references_field_error_envelope_for_a_bad_email(
        self,
    ) -> None:
        model = make_model()

        with pytest.raises(ApiError) as excinfo:
            asyncio.run(
                UsersController(model).create({"name": "New Person", "email": "nope"})
            )

        assert excinfo.value.status == 400
        assert excinfo.value.payload == {
            "error": "Missing fields. Failed to create user.",
            "errors": {"email": ["Enter a valid email address."]},
        }

        assert model.create.calls == []


class TestUpdate:
    def test_responds_with_the_success_envelope_pointing_at_the_row(self) -> None:
        model = make_model(update=AsyncStub(result="ok"))

        result = asyncio.run(
            UsersController(model).update(
                "1", {"name": "Renamed", "email": "renamed@example.test"}
            )
        )

        assert result.model_dump(by_alias=True, exclude_none=True) == {
            "ok": True,
            "message": "User updated.",
            "redirectTo": "/users/1",
        }

    def test_throws_the_references_404_message_for_a_missing_row(self) -> None:
        model = make_model(update=AsyncStub(result="missing"))

        with pytest.raises(ApiError) as excinfo:
            asyncio.run(
                UsersController(model).update(
                    "999", {"name": "Renamed", "email": "renamed@example.test"}
                )
            )

        assert excinfo.value.status == 404
        assert excinfo.value.payload == {"error": "That user no longer exists."}


class TestRemove:
    def test_responds_with_the_redirect_to_the_people_listing(self) -> None:
        model = make_model(remove=AsyncStub(result=("ok", "")))

        result = asyncio.run(UsersController(model).remove("3"))

        assert result.model_dump(by_alias=True, exclude_none=True) == {
            "ok": True,
            "message": "User deleted.",
            "redirectTo": "/users",
        }

    def test_throws_the_references_404_message_for_a_missing_row(self) -> None:
        model = make_model(remove=AsyncStub(result=("missing", "")))

        with pytest.raises(ApiError) as excinfo:
            asyncio.run(UsersController(model).remove("999"))

        assert excinfo.value.status == 404
        assert excinfo.value.payload == {"error": "That user no longer exists."}

    def test_throws_the_409_guard_message_when_the_member_has_comments(self) -> None:
        model = make_model(
            remove=AsyncStub(
                result=(
                    "restricted",
                    "This person still has 2 comments and 2 tasks. "
                    "Remove the comments before deleting.",
                )
            )
        )

        with pytest.raises(ApiError) as excinfo:
            asyncio.run(UsersController(model).remove("2"))

        assert excinfo.value.status == 409
        assert excinfo.value.payload == {
            "error": "This person still has 2 comments and 2 tasks. "
            "Remove the comments before deleting."
        }
