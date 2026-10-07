# app/health/routes.py
#
# The readiness endpoint. spec/contract.md: `GET /healthz` returns HTTP 200
# with `{"ok":true}` — it may check DB connectivity, must not perform writes.
#
# It deliberately does NOT check connectivity: Playwright starts the web
# server before its global-setup creates the test database, so a healthz that
# touched Postgres would never go ready on a clean machine.

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.get("/healthz")
async def healthz() -> dict[str, bool]:
    return {"ok": True}
