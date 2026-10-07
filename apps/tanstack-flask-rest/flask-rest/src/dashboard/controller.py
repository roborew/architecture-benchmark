# src/dashboard/dashboard.controller.py
#
# The controller layer: the one read this surface has. It knows neither SQL
# nor Flask: the routing layer hands it the request and jsonifies the
# (status, payload) it decides on; the model knows SQL and nothing about HTTP.

from src.dashboard.model import DashboardModel

#: What a controller hands back to the routing layer: status + JSON payload.
ActionResult = tuple[int, dict]


class DashboardController:
    def __init__(self, model: DashboardModel) -> None:
        self._model = model

    def get(self) -> ActionResult:
        """GET /api/dashboard — the stats, recent tasks and busiest projects.

        The three sections render together, so they are fetched together in
        the reply — one slow section should not be the reason the cards
        appear one by one. (The express variant fires the three queries
        concurrently with Promise.all; the queries are run in sequence here —
        against the same database they answer in the same order, and the
        response shape is identical.)
        """
        stats = self._model.stats()
        recent_tasks = self._model.recent_tasks()
        projects = self._model.projects()

        return 200, {"stats": stats, "recentTasks": recent_tasks, "projects": projects}
