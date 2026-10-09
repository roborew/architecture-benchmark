# syntax=docker/dockerfile:1
#
# python-api archetype (plan §3.3), FastAPI variant. Production ASGI server:
# uvicorn, binding 0.0.0.0:4000 with 2 workers — one per CPU of the rig's
# 2-CPU cap. The event loop is uvicorn's default (asyncio; uvloop is not a
# dependency), and each worker owns its own AsyncConnectionPool. These are the
# worker/loop settings the plan requires recording; see the README's "Run in
# Docker" section for the rationale.
#
# Python is pinned to 3.14, the version the app is developed and tested on
# (pyproject.toml requires >=3.13). There is no lockfile, so the app is
# installed from `pyproject.toml` with `pip install .`

FROM python:3.14-slim AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /build
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# `app/` is a clean top-level package, so installing the project pulls the
# runtime dependencies and the app itself into the virtualenv.
COPY pyproject.toml README.md ./
COPY app ./app
RUN pip install .

FROM python:3.14-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/opt/venv/bin:$PATH" \
    PORT=4000

# wget: the compose healthcheck shells out to it (debian-slim has none).
# libpq5: the app uses `psycopg[pool]` without the bundled binary wheel, so the
# psycopg C/pq wrapper needs the system libpq at runtime.
RUN apt-get update \
 && apt-get install -y --no-install-recommends wget libpq5 \
 && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/venv /opt/venv

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin appuser
USER appuser
WORKDIR /home/appuser

EXPOSE 4000
CMD ["sh", "-c", "exec uvicorn app.main:create_app --factory --host 0.0.0.0 --port ${PORT:-4000} --workers 2"]
