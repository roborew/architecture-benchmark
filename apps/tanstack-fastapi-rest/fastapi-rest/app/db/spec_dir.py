# app/db/spec_dir.py
#
# The normative spec lives at the repo root (`spec/`), not inside the app, so
# both migrate.py and seed.py resolve it the same way. Walking up until we
# find spec/schema.sql keeps this correct regardless of where the db scripts
# sit in app/.

from __future__ import annotations

from pathlib import Path

_MARKER = Path("spec") / "schema.sql"


def _find_spec_root(start: Path) -> Path:
    directory = start
    # Stop at the filesystem root; `Path("/").parent == Path("/")` would loop
    # forever.
    while True:
        if (directory / _MARKER).exists():
            return directory

        parent = directory.parent
        if parent == directory:
            raise FileNotFoundError(
                f"Could not locate the spec directory: no {_MARKER} found "
                f"in any parent of {start}"
            )
        directory = parent


_current_directory = Path(__file__).resolve().parent

#: Absolute path to the repo-root `spec/` directory.
spec_directory = _find_spec_root(_current_directory) / "spec"

#: Absolute path to `spec/schema.sql`.
schema_path = spec_directory / "schema.sql"

#: Absolute path to `spec/snapshots/`.
snapshots_directory = spec_directory / "snapshots"
