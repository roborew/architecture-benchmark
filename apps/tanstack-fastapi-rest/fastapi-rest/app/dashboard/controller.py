# app/dashboard/controller.py
#
# The controller layer: the one read this surface has. It knows nothing about
# SQL or FastAPI; the model knows SQL and nothing about HTTP; the route knows
# FastAPI and nothing about either.

from __future__ import annotations

import asyncio

from .model import DashboardModel
from .schemas import Dashboard


class DashboardController:
    """Maps the dashboard's one request onto three model calls."""

    def __init__(self, model: DashboardModel) -> None:
        self._model = model

    async def get(self) -> Dashboard:
        """GET /api/dashboard — the stats, recent tasks and busiest projects."""
        # The three sections render together, so they are fetched together;
        # one slow section should not be the reason the cards appear one by
        # one.
        stats, recent_tasks, projects = await asyncio.gather(
            self._model.stats(),
            self._model.recent_tasks(),
            self._model.projects(),
        )

        return Dashboard(stats=stats, recent_tasks=recent_tasks, projects=projects)
