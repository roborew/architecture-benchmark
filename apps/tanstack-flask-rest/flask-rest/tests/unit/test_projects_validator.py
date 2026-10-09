# tests/unit/test_projects_validator.py
#
# The projects validator's pure contract: the create/update body. The message
# strings are pinned verbatim against the reference variant's ProjectSchema
# (actions.ts) — a drift here is a client-visible change to the API's error
# contract. No database, no Flask.

from src.projects.validator import parse_project_body


class TestParseProjectBody:
    def test_accepts_a_name_and_description_trimmed(self):
        parsed = parse_project_body(
            {"name": "  Website redesign  ", "description": "  A refresh  "}
        )

        assert parsed is not None
        assert parsed.name == "Website redesign"
        assert parsed.description == "A refresh"

    def test_produces_the_reference_name_messages_verbatim(self):
        # An empty name reaches the min rule; an omitted one fails the type
        # check first, exactly as the reference's FormData parse does.
        parsed = parse_project_body({"name": "", "description": "d"})
        assert parsed.errors == {"name": ["Project name is required."]}

        parsed = parse_project_body({"name": "  ", "description": "d"})
        assert parsed.errors == {"name": ["Project name is required."]}

        parsed = parse_project_body({"name": "a" * 201, "description": "d"})
        assert parsed.errors == {
            "name": ["Project name must be 200 characters or fewer."]
        }

    def test_requires_a_description_exactly_as_the_reference_schema_does(self):
        # The reference's ProjectSchema does not preprocess description, so an
        # omitted field is a type failure — not silently an empty description.
        parsed = parse_project_body({"name": "Website redesign"})
        assert parsed.errors == {
            "description": ["Invalid input: expected string, received null"]
        }

        parsed = parse_project_body({"name": "n", "description": ""})
        assert parsed is not None
        assert parsed.description == ""
