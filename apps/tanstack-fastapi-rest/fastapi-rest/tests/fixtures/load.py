"""tests/fixtures/load.py

Reads the fixture profile from the shared, normative
`spec/snapshots/<profile>/` — the same CSV source every app variant uses to
seed a database. Nothing here is imported by the app itself: this is test
infrastructure only.

Unquoted CSV, exactly like spec/seed-spec.md: fixture values never contain
commas, quotes or newlines.
"""

from __future__ import annotations

from app.db.spec_dir import snapshots_directory

#: Fixture profile the app's test tiers assert against.
FIXTURE_PROFILE = "correctness"

fixture_directory = snapshots_directory / FIXTURE_PROFILE


def _parse_csv(file: str) -> list[dict[str, str]]:
    # Normalise CRLF before splitting. A checkout that carries \r would leave it
    # glued to the last column name (`email\r`), so the header and the rows
    # disagree about the final column and every row's last value reads back as
    # None — which then cascades into any row built from it.
    text = (
        (fixture_directory / file)
        .read_text(encoding="utf-8")
        .replace("\r\n", "\n")
        .rstrip()
    )
    lines = text.split("\n")
    header, lines = lines[0], lines[1:]

    # A file with no trailing newline leaves one empty fragment behind.
    rows = [line for line in lines if line]

    columns = [column.strip() for column in header.split(",")]

    return [
        {column: values[index] for index, column in enumerate(columns)}
        for values in (line.split(",") for line in rows)
    ]


def load_raw_rows() -> dict[str, list[dict[str, str]]]:
    """Raw rows keyed by table name, for `COPY`-style bulk insertion. The rows
    match the schema column names exactly, which is the contract
    `COPY ... header true` relies on."""
    return {
        "users": _parse_csv("users.csv"),
        "projects": _parse_csv("projects.csv"),
        "tasks": _parse_csv("tasks.csv"),
        "comments": _parse_csv("comments.csv"),
    }


#: Fixture table names in foreign-key-safe insertion order.
FIXTURE_TABLES = ["users", "projects", "tasks", "comments"]
