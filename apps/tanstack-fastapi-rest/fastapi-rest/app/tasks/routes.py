# app/tasks/routes.py
#
# The routing layer for tasks: maps the REST surface onto controller calls.
# Mounted by the app factory under /api/tasks, so this file never sees the
# mount point and can be mounted anywhere without changes.
#
# `/count` and `/with-comment` are registered before the `/{id}` shapes: a
# router matches in registration order, so a literal segment must come before
# a parameter that would otherwise capture it ("count" as a task id,
# "with-comment" as a task id).
#
# The handlers are deliberately thin adapters: they read the raw request
# pieces (query bag, JSON body, path id) and hand them to the controller —
# validation, model calls and envelopes are the controller's, so this layer
# has nothing of its own to test.

from __future__ import annotations

from fastapi import APIRouter, Request

from app.lib.mutation import MutationResult
from app.lib.request_bag import query_bag, read_json_body

from .controller import TasksController
from .schemas import Comment, CountResult, Task, TaskRow


def build_router(controller: TasksController) -> APIRouter:
    """The tasks APIRouter, wired to one controller."""
    router = APIRouter()

    @router.get("", response_model=list[TaskRow])
    async def list_tasks(request: Request) -> list[TaskRow]:
        return await controller.list(query_bag(request))

    @router.get("/count", response_model=CountResult)
    async def count_tasks(request: Request) -> CountResult:
        return await controller.count(query_bag(request))

    @router.post("/with-comment", response_model=MutationResult, status_code=201, response_model_exclude_none=True)
    async def create_task_with_comment(request: Request) -> MutationResult:
        return await controller.create_with_comment(await read_json_body(request))

    @router.post("", response_model=MutationResult, status_code=201, response_model_exclude_none=True)
    async def create_task(request: Request) -> MutationResult:
        return await controller.create(await read_json_body(request))

    @router.get("/{id}/comments", response_model=list[Comment])
    async def list_task_comments(id: str) -> list[Comment]:
        return await controller.list_comments(id)

    @router.post("/{id}/comments", response_model=MutationResult, status_code=201, response_model_exclude_none=True)
    async def add_task_comment(id: str, request: Request) -> MutationResult:
        return await controller.add_comment(id, await read_json_body(request))

    @router.get("/{id}", response_model=Task)
    async def get_task(id: str) -> Task:
        return await controller.get(id)

    @router.patch("/{id}", response_model=MutationResult, response_model_exclude_none=True)
    async def update_task(id: str, request: Request) -> MutationResult:
        return await controller.update(id, await read_json_body(request))

    @router.delete("/{id}", response_model=MutationResult, response_model_exclude_none=True)
    async def delete_task(id: str) -> MutationResult:
        return await controller.remove(id)

    return router
