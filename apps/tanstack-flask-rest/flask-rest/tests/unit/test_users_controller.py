# tests/unit/test_users_controller.py
#
# The controller's HTTP contract with the model stubbed: what it sends to the
# model, what (status, payload) it decides on, and which HttpError it raises
# for each refused outcome (the error handler maps the raise to the same JSON
# envelope). No database, no Flask — the controller takes plain values.

import pytest

from src.lib.http_error import HttpError
from src.users.controller import UsersController
from src.users.model import DeleteRestricted

USER = {
    "id": 1,
    "name": "Unit Person",
    "email": "unit@example.test",
    "assignedTaskCount": 0,
    "openTaskCount": 0,
    "commentCount": 0,
}


class FakeUsersModel:
    def __init__(self, **results):
        self.calls = []
        self.results = results

    def list(self, term):
        self.calls.append(("list", term))
        return self.results.get("list", [])

    def get(self, id):
        self.calls.append(("get", id))
        return self.results.get("get")

    def list_tasks(self, assignee_id):
        self.calls.append(("list_tasks", assignee_id))
        return self.results.get("list_tasks", [])

    def create(self, input):
        self.calls.append(("create", input))
        return self.results.get("create", 4)

    def update(self, id, input):
        self.calls.append(("update", id, input))
        return self.results.get("update", "ok")

    def remove(self, id):
        self.calls.append(("remove", id))
        return self.results.get("remove", "ok")


class TestList:
    def test_responds_200_with_the_models_rows(self):
        model = FakeUsersModel(list=[USER])
        status, payload = UsersController(model).list(["  robin  "])

        assert status == 200
        assert payload == [USER]
        assert model.calls == [("list", "robin")]

    def test_raises_the_400_envelope_when_q_is_repeated(self):
        model = FakeUsersModel(list=[])

        with pytest.raises(HttpError) as raised:
            UsersController(model).list(["robin", "sam"])

        assert raised.value.status == 400
        assert raised.value.payload == {"error": "q must be a single value"}

        # No query may run for a request the API refused.
        assert model.calls == []

    def test_raises_400_when_q_exceeds_100_characters(self):
        model = FakeUsersModel(list=[])

        with pytest.raises(HttpError) as raised:
            UsersController(model).list(["a" * 101])

        assert raised.value.payload == {"error": "q must be at most 100 characters"}
        assert model.calls == []

    def test_passes_a_100_character_q_through_as_valid(self):
        model = FakeUsersModel(list=[])
        UsersController(model).list(["a" * 100])

        assert model.calls == [("list", "a" * 100)]


class TestGet:
    def test_responds_200_with_the_models_row(self):
        model = FakeUsersModel(get=USER)
        status, payload = UsersController(model).get("1")

        assert model.calls == [("get", 1)]
        assert (status, payload) == (200, USER)

    def test_raises_the_plain_404_envelope_when_the_row_is_missing(self):
        model = FakeUsersModel(get=None)

        with pytest.raises(HttpError) as raised:
            UsersController(model).get("999")

        assert raised.value.status == 404
        assert raised.value.payload == {"error": "Not found"}

    def test_raises_400_for_an_id_that_cannot_name_a_row(self):
        model = FakeUsersModel(get=USER)

        with pytest.raises(HttpError) as raised:
            UsersController(model).get("abc")

        assert raised.value.payload == {"error": "id must be a positive integer"}
        assert model.calls == []


class TestListTasks:
    def test_responds_200_with_the_models_rows_scoped_by_the_route_id(self):
        task = {"id": 101, "assigneeName": "Unit Person"}
        model = FakeUsersModel(list_tasks=[task])
        status, payload = UsersController(model).list_tasks("1")

        assert model.calls == [("list_tasks", 1)]
        assert (status, payload) == (200, [task])


class TestCreate:
    def test_responds_201_with_the_success_envelope_pointing_at_the_new_row(self):
        model = FakeUsersModel(create=4)
        status, payload = UsersController(model).create(
            {"name": "New Person", "email": "new@example.test"}
        )

        assert model.calls[0][0] == "create"
        assert model.calls[0][1].name == "New Person"
        assert model.calls[0][1].email == "new@example.test"
        assert (status, payload) == (
            201,
            {"ok": True, "message": "User created.", "redirectTo": "/users/4"},
        )

    def test_raises_the_reference_field_error_envelope_for_a_bad_email(self):
        model = FakeUsersModel()

        with pytest.raises(HttpError) as raised:
            UsersController(model).create({"name": "New Person", "email": "nope"})

        assert raised.value.status == 400
        assert raised.value.payload == {
            "error": "Missing fields. Failed to create user.",
            "errors": {"email": ["Enter a valid email address."]},
        }
        assert model.calls == []


class TestUpdate:
    def test_responds_200_with_the_success_envelope_pointing_at_the_row(self):
        model = FakeUsersModel(update="ok")
        status, payload = UsersController(model).update(
            "1", {"name": "Renamed", "email": "renamed@example.test"}
        )

        assert (status, payload) == (
            200,
            {"ok": True, "message": "User updated.", "redirectTo": "/users/1"},
        )

    def test_raises_the_reference_404_message_for_a_missing_row(self):
        model = FakeUsersModel(update="missing")

        with pytest.raises(HttpError) as raised:
            UsersController(model).update(
                "999", {"name": "Renamed", "email": "renamed@example.test"}
            )

        assert raised.value.payload == {"error": "That user no longer exists."}


class TestRemove:
    def test_responds_200_with_the_redirect_to_the_people_listing(self):
        model = FakeUsersModel(remove="ok")
        status, payload = UsersController(model).remove("3")

        assert (status, payload) == (
            200,
            {"ok": True, "message": "User deleted.", "redirectTo": "/users"},
        )

    def test_raises_the_reference_404_message_for_a_missing_row(self):
        model = FakeUsersModel(remove="missing")

        with pytest.raises(HttpError) as raised:
            UsersController(model).remove("999")

        assert raised.value.payload == {"error": "That user no longer exists."}

    def test_raises_the_409_guard_message_when_the_member_has_comments(self):
        message = (
            "This person still has 2 comments and 2 tasks. "
            "Remove the comments before deleting."
        )
        model = FakeUsersModel(remove=DeleteRestricted(message=message))

        with pytest.raises(HttpError) as raised:
            UsersController(model).remove("2")

        assert raised.value.status == 409
        assert raised.value.payload == {"error": message}
