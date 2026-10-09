# syntax=docker/dockerfile:1
#
# python-api archetype (plan §3.3), Flask variant. Production WSGI server:
# gunicorn, binding 0.0.0.0:4000 with 2 gthread workers x 4 threads = 8
# concurrent requests — one worker per CPU of the rig's 2-CPU cap, threads to
# answer the bursts of parallel fetches the SPA's TanStack Query layer fires
# (the app's own Db pool blocks rather than refusing waiters). These are the
# worker settings the plan requires recording; see the README's "Run in
# Docker" section for the rationale.
#
# Python is pinned to 3.14 — the version the app is developed and tested on.
# (The code relies on PEP 649 deferred annotations; on 3.13 a method named
# `list` in a Protocol body shadows the builtin for later class-scope
# annotations. Pinning the dev runtime keeps the benchmark faithful to the
# app as authored.) There is no lockfile, so the dependencies are installed
# from `pyproject.toml` with `pip install .`.
#
# `src/` is itself a package (src/__init__.py) and every internal import is
# `src.…`, so the app is run from the copied source exactly as the dev workflow
# does (`python -m src.server` -> `gunicorn src.server:app`).

FROM python:3.14-slim AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /build
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install the app's runtime dependencies (pulled from pyproject.toml) plus the
# production WSGI server. The project itself is not needed at runtime — the
# source is copied into the final stage below — so it is uninstalled again to
# keep the virtualenv free of the flat modules setuptools' src-layout emits.
COPY pyproject.toml ./
COPY src ./src
RUN pip install . gunicorn \
 && pip uninstall -y flask-rest

FROM python:3.14-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/opt/venv/bin:$PATH" \
    PORT=4000

# The healthcheck shells out to wget (as the sibling node-api images' busybox
# provides); debian-slim has no wget, so add it before dropping privileges.
RUN apt-get update \
 && apt-get install -y --no-install-recommends wget \
 && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/venv /opt/venv

WORKDIR /app
COPY src ./src

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin appuser
USER appuser

EXPOSE 4000
CMD ["sh", "-c", "exec gunicorn --bind 0.0.0.0:${PORT:-4000} --workers 2 --threads 4 --worker-class gthread --access-logfile - --error-logfile - src.server:app"]
