"""The REST API variant of the architecture benchmark, rebuilt on Flask.

Package layout mirrors the sibling `express-rest` variant layer for layer:
``<domain>/model.py`` is the only place that knows SQL, ``<domain>/controller.py``
validates the request and decides the response (no SQL), ``<domain>/routes.py``
maps the REST surface onto controller calls, and ``<domain>/validator.py`` holds
pure input validation (unit-testable without Flask). ``src/app.py`` is the
composition root: connection -> models -> controllers -> blueprints, wired there
and nowhere else.
"""
