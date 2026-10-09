# src/config/env.py
#
# Environment resolution, in one place. Nothing here loads Flask: scripts,
# pytest and the server entry all resolve the same variables, exactly as the
# express variant's src/config/env.ts does for node.
#
# The `.env` file is read manually (no python-dotenv dependency): its values
# never override an exported variable, they only fill the gaps.

import os
from pathlib import Path

# The app root — the directory holding `.env` — is two levels above this file
# (src/config/env.py -> src/config -> src -> flask-rest).
_ENV_PATH = Path(__file__).resolve().parents[2] / ".env"


def _load_env_file(path: Path) -> None:
    """Reads KEY=VALUE lines into the environment, without overriding."""
    if not path.is_file():
        return

    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()

        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue

        key, _, value = stripped.partition("=")
        key = key.strip()
        value = value.strip()

        # Strip a matching pair of single or double quotes around the value.
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]

        if key:
            os.environ.setdefault(key, value)


_load_env_file(_ENV_PATH)

#: Postgres connection string; the one source of truth for host + credentials.
POSTGRES_URL: str = os.environ.get("POSTGRES_URL", "")

#: HTTP port the standalone server listens on.
PORT: int = int(os.environ.get("PORT", "4000"))


def require_postgres_url(override: str | None = None) -> str:
    """The connection string to use, or a clear error when there is none.

    Integration tests pass an override pointing at their isolated database;
    production omits it and the resolved ``POSTGRES_URL`` applies.
    """
    url = override if override is not None else POSTGRES_URL

    if not url:
        raise RuntimeError(
            "Missing database connection string: set POSTGRES_URL in .env"
        )

    return url
