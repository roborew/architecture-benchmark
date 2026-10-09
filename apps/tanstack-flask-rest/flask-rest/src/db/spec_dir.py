# src/db/spec_dir.py
#
# The normative spec lives at the repo root (`spec/`), not inside the app, so
# both `migrate.py` and `seed.py` (and the test lifecycle) resolve it the same
# way. Walking up until we find `spec/schema.sql` keeps this correct regardless
# of where the app sits in the monorepo.

from pathlib import Path

_MARKER = Path("spec") / "schema.sql"


def _find_spec_root(from_dir: Path) -> Path:
    directory = from_dir
    while True:
        if (directory / _MARKER).is_file():
            return directory

        parent = directory.parent
        if parent == directory:
            raise RuntimeError(
                f"Could not locate the spec directory: no {_MARKER} found in "
                f"any parent of {from_dir}"
            )
        directory = parent


def spec_directory() -> Path:
    """Absolute path to the repo-root `spec/` directory."""
    return _find_spec_root(Path(__file__).resolve().parents[2]) / "spec"


def schema_path() -> Path:
    """Absolute path to `spec/schema.sql`."""
    return spec_directory() / "schema.sql"


def snapshots_directory() -> Path:
    """Absolute path to `spec/snapshots/`."""
    return spec_directory() / "snapshots"
