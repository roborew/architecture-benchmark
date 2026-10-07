# app/main.py
#
# The app factory — the composition root.
#
# `create_app` builds the FastAPI application and wires the layers together
# (routers → controllers → models → pool). Tests import it and drive it with
# Starlette's TestClient rather than binding a port; the uvicorn entry
# (`uvicorn app.main:create_app --factory`) is the only place that listens.
# The dependency is inverted: the server entry depends on the factory, never
# the reverse, so importing the app never opens a socket.
#
# The pool is created here and opened/closed by the app's lifespan — the
# FastAPI-documented startup/shutdown hook — so the process owns exactly one
# pool and importing this module is side-effect free. Tests that bring their
# own pool pass it in and keep ownership of it.

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import require_postgres_url
from app.dashboard.controller import DashboardController
from app.dashboard.model import create_dashboard_model
from app.dashboard.routes import build_router as build_dashboard_router
from app.db.connection import ConnectionPool, create_pool
from app.errors import register_exception_handlers
from app.health.routes import router as health_router
from app.projects.controller import ProjectsController
from app.projects.model import create_projects_model
from app.projects.routes import build_router as build_projects_router
from app.tasks.controller import TasksController
from app.tasks.model import create_tasks_model
from app.tasks.routes import build_router as build_tasks_router
from app.users.controller import UsersController
from app.users.model import create_users_model
from app.users.routes import build_router as build_users_router


def create_app(
    postgres_url: str | None = None, *, pool: ConnectionPool | None = None
) -> FastAPI:
    """Builds the application: the API surface, wired to one pool.

    `postgres_url` overrides the connection string the data layer uses
    (integration tests point it at the isolated test database; production
    omits it and app/config.py supplies the value). `pool` lets a caller that
    manages its own connections lend the app one, in which case the lifespan
    never opens or closes it — the caller owns its lifecycle.
    """

    # A pool lent in is owned by its lender; the lifespan only manages the
    # pool this factory created.
    owns_pool = pool is None
    db = pool if pool is not None else create_pool(require_postgres_url(postgres_url))

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        if owns_pool:
            await db.open()
        yield
        if owns_pool:
            await db.close()

    app = FastAPI(
        title="architecture-benchmark — fastapi-rest",
        version="1.0.0",
        lifespan=lifespan,
    )

    # The frontend is a separate origin (Vite dev server / SPA host), so every
    # fetch the client makes is cross-origin. Origins are reflected rather
    # than allowlisted: this API serves no cookies or credentials, so there
    # is nothing a reflected origin could smuggle. A credentialed API would
    # need an explicit allowlist instead.
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=".*",
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # The error envelopes — the one place a non-2xx JSON shape is decided.
    register_exception_handlers(app)

    # The dependency chain, composed here and nowhere else: pool → model →
    # controller → router. Each layer sees only the layer below it.
    users_model = create_users_model(db)
    users_controller = UsersController(users_model)
    tasks_model = create_tasks_model(db)
    tasks_controller = TasksController(tasks_model)
    projects_model = create_projects_model(db)
    projects_controller = ProjectsController(projects_model)
    dashboard_model = create_dashboard_model(db)
    dashboard_controller = DashboardController(dashboard_model)

    app.include_router(health_router, tags=["health"])
    app.include_router(
        build_users_router(users_controller), prefix="/api/users", tags=["users"]
    )
    app.include_router(
        build_tasks_router(tasks_controller), prefix="/api/tasks", tags=["tasks"]
    )
    app.include_router(
        build_projects_router(projects_controller),
        prefix="/api/projects",
        tags=["projects"],
    )
    app.include_router(
        build_dashboard_router(dashboard_controller),
        prefix="/api/dashboard",
        tags=["dashboard"],
    )

    return app
