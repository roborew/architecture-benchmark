# tests/unit/test_dashboard_controller.py
#
# The controller's HTTP contract with the model stubbed: what it asks the
# model for, and the (status, payload) it decides on. No database, no Flask —
# the controller takes plain values.

from src.dashboard.controller import DashboardController

STATS = {
    "projectCount": 3,
    "totalTasks": 6,
    "openTasks": 5,
    "peopleCount": 3,
    "todoTasks": 3,
    "inProgressTasks": 2,
    "doneTasks": 1,
}

RECENT_TASKS = [
    {
        "id": 101,
        "title": "Draft navigation model",
        "projectName": "Website redesign",
        "status": "in progress",
        "assigneeName": "Robin Andrew",
        "updatedAt": "2026-09-29T08:00:00Z",
    }
]

PROJECTS = [
    {
        "id": 1,
        "name": "Website redesign",
        "description": "Refresh the public website.",
        "taskCount": 3,
        "openTaskCount": 2,
        "peopleCount": 3,
    }
]


class FakeDashboardModel:
    def __init__(self):
        self.calls = []

    def stats(self):
        self.calls.append("stats")
        return STATS

    def recent_tasks(self):
        self.calls.append("recent_tasks")
        return RECENT_TASKS

    def projects(self):
        self.calls.append("projects")
        return PROJECTS


class TestGet:
    def test_responds_200_with_the_three_sections_in_one_body(self):
        model = FakeDashboardModel()
        status, payload = DashboardController(model).get()

        assert (status, payload) == (
            200,
            {"stats": STATS, "recentTasks": RECENT_TASKS, "projects": PROJECTS},
        )

    def test_fetches_every_section_so_they_render_together(self):
        # The three sections render together, so they are fetched together.
        model = FakeDashboardModel()

        DashboardController(model).get()

        assert model.calls == ["stats", "recent_tasks", "projects"]
