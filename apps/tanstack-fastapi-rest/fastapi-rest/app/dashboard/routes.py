# app/dashboard/routes.py
#
# The routing layer for the dashboard: maps the REST surface onto controller
# calls. Mounted by the app factory under /api/dashboard, so this file never
# sees the mount point and can be mounted anywhere without changes.

from __future__ import annotations

from fastapi import APIRouter

from .controller import DashboardController
from .schemas import Dashboard


def build_router(controller: DashboardController) -> APIRouter:
    """The dashboard APIRouter, wired to one controller."""
    router = APIRouter()

    @router.get("", response_model=Dashboard)
    async def get_dashboard() -> Dashboard:
        return await controller.get()

    return router
