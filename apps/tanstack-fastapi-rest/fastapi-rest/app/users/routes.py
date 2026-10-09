# app/users/routes.py
#
# The routing layer for users: maps the REST surface onto controller calls.
# Mounted by the app factory under /api/users, so this file never sees the
# mount point and can be mounted anywhere without changes.
#
# `/{id}/tasks` is registered before `/{id}` — a router matches in
# registration order, so a literal segment must come before a parameter that
# would otherwise capture it.

from __future__ import annotations

from fastapi import APIRouter, Request

from app.lib.mutation import MutationResult
from app.lib.request_bag import query_bag, read_json_body
from app.tasks.schemas import Task

from .controller import UsersController
from .schemas import User


def build_router(controller: UsersController) -> APIRouter:
    """The users APIRouter, wired to one controller."""
    router = APIRouter()

    @router.get("", response_model=list[User])
    async def list_users(request: Request) -> list[User]:
        return await controller.list(query_bag(request))

    @router.get("/{id}/tasks", response_model=list[Task])
    async def list_user_tasks(id: str) -> list[Task]:
        return await controller.list_tasks(id)

    @router.get("/{id}", response_model=User)
    async def get_user(id: str) -> User:
        return await controller.get(id)

    @router.post("", response_model=MutationResult, status_code=201, response_model_exclude_none=True)
    async def create_user(request: Request) -> MutationResult:
        return await controller.create(await read_json_body(request))

    @router.patch("/{id}", response_model=MutationResult, response_model_exclude_none=True)
    async def update_user(id: str, request: Request) -> MutationResult:
        return await controller.update(id, await read_json_body(request))

    @router.delete("/{id}", response_model=MutationResult, response_model_exclude_none=True)
    async def delete_user(id: str) -> MutationResult:
        return await controller.remove(id)

    return router
