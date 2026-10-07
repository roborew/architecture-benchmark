# app/config.py
#
# Environment resolution, in one place. pydantic-settings does the reading:
# exported variables win over the app's `.env` file (exactly the resolution
# order the Express variant's env.ts implements), so the server, the db
# scripts and the tests all resolve the same values.

from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# The `.env` file lives at the app root (fastapi-rest/.env), resolved from
# this module so a server started from another directory still finds it.
_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


class Settings(BaseSettings):
    """POSTGRES_URL and PORT, with the same defaults the Express variant has."""

    model_config = SettingsConfigDict(env_file=_ENV_FILE, extra="ignore")

    postgres_url: str = ""
    port: int = 4000


settings = Settings()


def require_postgres_url(override: str | None = None) -> str:
    """The connection string the app's data layer must use, or a clear error.

    `override` lets a caller (an integration test) point the app at a
    database of its choosing; production omits it and the environment
    supplies the value.
    """
    url = override or settings.postgres_url

    if not url:
        raise ValueError("Missing database connection string: set POSTGRES_URL in .env")

    return url
