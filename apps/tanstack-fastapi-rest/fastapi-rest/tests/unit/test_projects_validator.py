"""tests/unit/test_projects_validator.py

The projects validator's pure contract: the create/update body. The message
strings are pinned verbatim against the reference variant's ProjectSchema
(actions.ts — the zod schema) — a drift here is a client-visible change to
the API's error contract. No database, no FastAPI.
"""

from __future__ import annotations

from app.projects.validator import ProjectBodyFields, parse_project_body


class TestParseProjectBody:
    def test_accepts_a_name_and_description_trimmed(self) -> None:
        assert parse_project_body(
            {"name": "  Website redesign  ", "description": "  A refresh  "}
        ) == (
            ProjectBodyFields(name="Website redesign", description="A refresh"),
            None,
        )

    def test_produces_the_references_name_messages_verbatim(self) -> None:
        # An empty name reaches the min rule; an omitted one fails the type
        # check first, exactly as the reference's FormData parse does.
        assert parse_project_body({"name": "", "description": "d"}) == (
            None,
            {"name": ["Project name is required."]},
        )
        assert parse_project_body({"name": "  ", "description": "d"}) == (
            None,
            {"name": ["Project name is required."]},
        )
        assert parse_project_body({"name": "a" * 201, "description": "d"}) == (
            None,
            {"name": ["Project name must be 200 characters or fewer."]},
        )

    def test_requires_a_description_exactly_as_the_references_schema_does(self) -> None:
        # The reference's ProjectSchema does not preprocess description, so
        # an omitted field is a type failure — not silently an empty
        # description.
        assert parse_project_body({"name": "Website redesign"}) == (
            None,
            {"description": ["Invalid input: expected string, received null"]},
        )
        assert parse_project_body({"name": "n", "description": ""}) == (
            ProjectBodyFields(name="n", description=""),
            None,
        )
