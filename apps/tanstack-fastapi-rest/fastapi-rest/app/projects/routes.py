# app/projects/routes.py
#
# The routing layer for projects: maps the REST surface onto controller
# calls. Mounted by the app factory under /api/projects, so this file never
# sees the mount point and can be mounted anywhere without changes.
#
# `/{id}/tasks` is registered before `/{id}` — a router matches in
# registration order, so a literal segment must come before a parameter that
# would otherwise capture it.

from __future__ import annotations

from fastapi import APIRouter, Request

from app.lib.mutation import MutationResult
from app.lib.request_bag import query_bag, read_json_body
from app.tasks.schemas import ProjectTaskRow

from .controller import ProjectsController
from .schemas import Project


def build_router(controller: ProjectsController) -> APIRouter:
    """The projects APIRouter, wired to one controller."""
    router = APIRouter()

    @router.get("", response_model=list[Project])
    async def list_projects(request: Request) -> list[Project]:
        return await controller.list(query_bag(request))

    @router.get("/{id}/tasks", response_model=list[ProjectTaskRow])
    async def list_project_tasks(id: str, request: Request) -> list[ProjectTaskRow]:
        return await controller.list_tasks(id, query_bag(request))

    @router.get("/{id}", response_model=Project)
    async def get_project(id: str) -> Project:
        return await controller.get(id)

    @router.post("", response_model=MutationResult, status_code=201, response_model_exclude_none=True)
    async def create_project(request: Request) -> MutationResult:
        return await controller.create(await read_json_body(request))

    @router.patch("/{id}", response_model=MutationResult, response_model_exclude_none=True)
    async def update_project(id: str, request: Request) -> MutationResult:
        return await controller.update(id, await read_json_body(request))

    @router.delete("/{id}", response_model=MutationResult, response_model_exclude_none=True)
    async def delete_project(id: str) -> MutationResult:
        return await controller.remove(id)

    return router
