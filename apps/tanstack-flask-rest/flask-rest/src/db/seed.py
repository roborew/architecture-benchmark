# src/db/seed.py
#
# Loads a canonical fixture profile from `spec/snapshots/<profile>/` into
# Postgres, so every app variant ends up with byte-identical rows
# (spec/seed-spec.md). The profile is a CLI argument:
#
#   python -m src.db.seed             # defaults to "small"
#   python -m src.db.seed small
#   python -m src.db.seed medium
#   python -m src.db.seed large
#
# SEED_PROFILE is also honoured. The CSVs are the single source of truth — this
# script never generates rows itself, so it cannot drift from the golden
# digests the benchmark rig verifies. (The hand-curated `correctness` profile
# the test tiers assert against has no manifest, so it cannot be seeded here —
# it is loaded by the test database helpers instead.)

import hashlib
import json
import os
import sys
from pathlib import Path

from psycopg2 import sql

from src.config.env import require_postgres_url
from src.db.connection import Db
from src.db.spec_dir import snapshots_directory

DEFAULT_PROFILE = "small"

# Insertion order respects the foreign keys: projects and users before tasks,
# tasks before comments.
TABLES = ("users", "projects", "tasks", "comments")


def _resolve_profile() -> str:
    positional = [a for a in sys.argv[1:] if not a.startswith("-")]

    if len(positional) > 1:
        raise RuntimeError(
            f"Expected at most one profile argument, received: {', '.join(positional)}"
        )

    return (
        positional[0] if positional else os.environ.get("SEED_PROFILE", DEFAULT_PROFILE)
    )


def _available_profiles() -> list[str]:
    return sorted(
        entry.name for entry in snapshots_directory().iterdir() if entry.is_dir()
    )


def _load_manifest(profile: str) -> dict:
    profile_directory = snapshots_directory() / profile

    if not profile_directory.is_dir():
        raise RuntimeError(
            f'Unknown seed profile "{profile}".\n'
            f"Available: {', '.join(_available_profiles()) or 'none'}\n"
            f"Expected fixtures at: {profile_directory}\n"
            "Generate them with:\n"
            f"  node testing-rig/src/fixtures/generate-fixture.mjs --profile {profile} --out spec/snapshots/{profile}",
        )

    manifest_path = profile_directory / "manifest.json"

    if not manifest_path.is_file():
        raise RuntimeError(f'Missing manifest for profile "{profile}": {manifest_path}')

    return json.loads(manifest_path.read_text(encoding="utf-8"))


def _verify_digests(profile_directory: Path, files: list[dict]) -> None:
    """Fail before touching the database if a CSV no longer matches its
    recorded digest — otherwise a corrupt fixture would seed quietly-wrong
    rows.

    The digest is taken over LF-normalised bytes: `manifest.json` records the
    files as committed, and a checkout with CRLF rewrites every CSV. Hashing
    the raw file would then fail on an unmodified checkout — the digest guards
    against corruption, not against a line-ending convention that changes no
    value.
    """
    for file in files:
        normalised = (
            (profile_directory / file["name"])
            .read_text(encoding="utf-8")
            .replace("\r\n", "\n")
            .replace("\r", "\n")
        )

        actual = hashlib.sha256(normalised.encode("utf-8")).hexdigest()
        if actual != file["sha256"]:
            raise RuntimeError(
                f"Digest mismatch for {file['name']}\n"
                f"  expected {file['sha256']}\n"
                f"  actual   {actual}\n"
                "The fixtures are corrupt or were regenerated; re-run the generator.",
            )

    print(f"Verified {len(files)} fixture digests")


def main() -> None:
    profile = _resolve_profile()
    profile_directory = snapshots_directory() / profile
    manifest = _load_manifest(profile)

    print(f'Seeding profile "{profile}"')
    _verify_digests(profile_directory, manifest["files"])

    database = Db(require_postgres_url())

    try:
        with database.transaction() as tx:
            # Truncating the leaves with CASCADE clears the whole graph in one
            # statement, in FK-safe order, so a re-seed cannot collide with
            # rows a previous run left behind.
            tx.query(
                sql.SQL("TRUNCATE TABLE {} RESTART IDENTITY CASCADE").format(
                    sql.SQL(", ").join(sql.Identifier(t) for t in reversed(TABLES))
                )
            )

            for table in TABLES:
                file = next(
                    (f for f in manifest["files"] if f["name"] == f"{table}.csv"),
                    None,
                )

                if file is None:
                    raise RuntimeError(f'Profile "{profile}" is missing {table}.csv')

                # `header true` makes Postgres skip the CSV header row.
                with (profile_directory / file["name"]).open("rb") as stream:
                    tx.copy_from_stdin(
                        f"COPY {table} FROM STDIN WITH (format csv, header true)",
                        stream,
                    )

            # Fixture rows carry explicit ids, which bypass the identity
            # sequences. Advance them past the loaded rows or the next live
            # insert collides.
            for table in TABLES:
                tx.query(
                    sql.SQL(
                        "SELECT setval("
                        "pg_get_serial_sequence(%(table)s, 'id'), "
                        "COALESCE((SELECT MAX(id) FROM {table}), 1))"
                    ).format(table=sql.Identifier(table)),
                    {"table": table},
                )

            for table in TABLES:
                row = tx.query(
                    sql.SQL("SELECT COUNT(*)::int AS count FROM {table}").format(
                        table=sql.Identifier(table)
                    )
                )[0]
                expected = manifest["rowCounts"][table]

                if row["count"] != expected:
                    raise RuntimeError(
                        f"Row count mismatch for {table}: "
                        f"expected {expected}, loaded {row['count']}"
                    )

                print(f"  {table}: {row['count']} rows")

        print(f'Seeding complete (profile "{profile}")')
    finally:
        database.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(error, file=sys.stderr)
        sys.exit(1)
