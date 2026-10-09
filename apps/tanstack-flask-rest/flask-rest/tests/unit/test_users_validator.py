# tests/unit/test_users_validator.py
#
# The users validator's pure contract: the create/update body. The message
# strings are pinned verbatim against the reference variant's UserSchema
# (actions.ts) — a drift here is a client-visible change to the API's error
# contract. No database, no Flask.

from src.users.validator import parse_user_body


class TestParseUserBody:
    def test_accepts_a_name_and_email_trimmed(self):
        parsed = parse_user_body(
            {"name": "  Robin Andrew  ", "email": "  robin@example.test  "}
        )

        assert parsed is not None
        assert parsed.name == "Robin Andrew"
        assert parsed.email == "robin@example.test"

    def test_produces_the_reference_messages_verbatim(self):
        # An empty name/email reaches the min rule; an omitted one fails the
        # type check first, exactly as the reference's FormData parse does.
        parsed = parse_user_body({"name": "", "email": "robin@example.test"})
        assert parsed.errors == {"name": ["User name is required."]}

        parsed = parse_user_body({"name": "a" * 201, "email": "e@x.test"})
        assert parsed.errors == {"name": ["User name must be 200 characters or fewer."]}

        # An empty email fails both the min rule and the format rule: the
        # reference's schema collects every issue in the chain.
        parsed = parse_user_body({"name": "Robin", "email": ""})
        assert parsed.errors == {
            "email": ["Email is required.", "Enter a valid email address."]
        }

        parsed = parse_user_body({"name": "Robin", "email": "not-an-address"})
        assert parsed.errors == {"email": ["Enter a valid email address."]}

    def test_reports_omitted_fields_exactly_as_the_reference_form_does(self):
        parsed = parse_user_body({})

        assert parsed.errors == {
            "name": ["Invalid input: expected string, received null"],
            "email": ["Invalid input: expected string, received null"],
        }

    def test_a_non_object_body_has_no_fields(self):
        parsed = parse_user_body(None)

        assert parsed.errors == {
            "name": ["Invalid input: expected string, received null"],
            "email": ["Invalid input: expected string, received null"],
        }
