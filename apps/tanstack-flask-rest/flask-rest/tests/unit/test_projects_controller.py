# tests/unit/test_projects_controller.py
#
# The controller's HTTP contract with the model stubbed: what it sends to the
# model, what (status, payload) it decides on, and which HttpError it raises
# for each refused outcome. No database, no Flask — the controller takes
# plain values.

import pytest

from src.lib.http_error import HttpError
from src.projects.controller import ProjectsController
from src.projects.model import DeleteRestricted

PROJECT = {
    "id": 1,
    "name": "Unit Project",
    "description": "d",
    "taskCount": 0,
    "openTaskCount": 0,
    "peopleCount": 0,
    "createdAt": "2026-09-27",
}


class FakeProjectsModel:
    def __init__(self, **results):
        self.calls = []
        self.results = results

    def list(self, term):
        self.calls.append(("list", term))
        return self.results.get("list", [])

    def get(self, id):
        self.calls.append(("get", id))
        return self.results.get("get")

    def list_tasks(self, project_id, filters):
        self.calls.append(("list_tasks", project_id, filters))
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
        model = FakeProjectsModel(list=[PROJECT])
        status, payload = ProjectsController(model).list([])

        assert (status, payload) == (200, [PROJECT])
        assert model.calls == [("list", "")]

    def test_raises_the_400_envelope_when_q_is_repeated(self):
        model = FakeProjectsModel()

        with pytest.raises(HttpError) as raised:
            ProjectsController(model).list(["redesign", "migration"])

        assert raised.value.payload == {"error": "q must be a single value"}
        assert model.calls == []


class TestGet:
    def test_responds_200_with_the_models_row(self):
        model = FakeProjectsModel(get=PROJECT)
        status, payload = ProjectsController(model).get("1")

        assert model.calls == [("get", 1)]
        assert (status, payload) == (200, PROJECT)

    def test_raises_the_plain_404_envelope_when_the_row_is_missing(self):
        model = FakeProjectsModel(get=None)

        with pytest.raises(HttpError) as raised:
            ProjectsController(model).get("999")

        assert raised.value.payload == {"error": "Not found"}


class TestListTasks:
    def test_passes_the_parsed_board_filters_scoped_by_the_route_id(self):
        model = FakeProjectsModel(list_tasks=[{"id": 101}])
        status, payload = ProjectsController(model).list_tasks(
            "1", {"status": ["todo"], "limit": ["2"]}
        )

        assert (status, payload) == (200, [{"id": 101}])
        project_id, filters = model.calls[0][1], model.calls[0][2]
        assert project_id == 1
        assert filters.status == "todo"
        assert filters.limit == 2

    def test_shares_the_tasks_status_rejection(self):
        model = FakeProjectsModel()

        with pytest.raises(HttpError) as raised:
            ProjectsController(model).list_tasks("1", {"status": ["shipped"]})

        assert raised.value.payload == {"error": "Unknown task status: shipped"}


class TestCreate:
    def test_responds_201_with_the_success_envelope_pointing_at_the_board(self):
        model = FakeProjectsModel(create=4)
        status, payload = ProjectsController(model).create(
            {"name": "Accessibility audit", "description": "Audit every surface."}
        )

        assert (status, payload) == (
            201,
            {"ok": True, "message": "Project created.", "redirectTo": "/projects/4"},
        )

    def test_requires_a_description_exactly_as_the_reference_schema_does(self):
        model = FakeProjectsModel()

        with pytest.raises(HttpError) as raised:
            ProjectsController(model).create({"name": "No description"})

        assert raised.value.payload == {
            "error": "Missing fields. Failed to create project.",
            "errors": {
                "description": ["Invalid input: expected string, received null"]
            },
        }
        assert model.calls == []


class TestUpdate:
    def test_responds_200_with_the_success_envelope(self):
        model = FakeProjectsModel(update="ok")
        status, payload = ProjectsController(model).update(
            "2", {"name": "Mobile application (v2)", "description": "d"}
        )

        assert (status, payload) == (
            200,
            {"ok": True, "message": "Project updated.", "redirectTo": "/projects/2"},
        )

    def test_raises_the_reference_404_message_for_a_missing_row(self):
        model = FakeProjectsModel(update="missing")

        with pytest.raises(HttpError) as raised:
            ProjectsController(model).update(
                "999", {"name": "No such", "description": "d"}
            )

        assert raised.value.payload == {"error": "That project no longer exists."}


class TestRemove:
    def test_responds_200_with_the_redirect_to_the_listing(self):
        model = FakeProjectsModel(remove="ok")
        status, payload = ProjectsController(model).remove("3")

        assert (status, payload) == (
            200,
            {"ok": True, "message": "Project deleted.", "redirectTo": "/projects"},
        )

    def test_raises_the_reference_404_message_for_a_missing_row(self):
        model = FakeProjectsModel(remove="missing")

        with pytest.raises(HttpError) as raised:
            ProjectsController(model).remove("999")

        assert raised.value.payload == {"error": "That project no longer exists."}

    def test_raises_the_409_guard_message_when_the_project_has_tasks(self):
        message = (
            "This project still has 1 task. Delete it before deleting the project."
        )
        model = FakeProjectsModel(remove=DeleteRestricted(message=message))

        with pytest.raises(HttpError) as raised:
            ProjectsController(model).remove("3")

        assert raised.value.status == 409
        assert raised.value.payload == {"error": message}
