"""tests/unit/test_users_validator.py

The users validator's pure contract: the create/update body. The message
strings are pinned verbatim against the reference variant's UserSchema
(actions.ts — the zod schema) — a drift here is a client-visible change to
the API's error contract. No database, no FastAPI.
"""

from __future__ import annotations

from app.users.validator import UserBodyFields, parse_user_body


class TestParseUserBody:
    def test_accepts_a_name_and_email_trimmed(self) -> None:
        assert parse_user_body(
            {"name": "  Robin Andrew  ", "email": "  robin@example.test  "}
        ) == (UserBodyFields(name="Robin Andrew", email="robin@example.test"), None)

    def test_produces_the_references_messages_verbatim(self) -> None:
        # An empty name/email reaches the min rule; an omitted one fails the
        # type check first, exactly as the reference's FormData parse does.
        assert parse_user_body({"name": "", "email": "robin@example.test"}) == (
            None,
            {"name": ["User name is required."]},
        )
        assert parse_user_body({"name": "a" * 201, "email": "e@x.test"}) == (
            None,
            {"name": ["User name must be 200 characters or fewer."]},
        )
        # An empty email fails both the min rule and the format rule: zod
        # collects every issue in the chain, and so does the reference's parse
        # of an empty submitted field.
        assert parse_user_body({"name": "Robin", "email": ""}) == (
            None,
            {"email": ["Email is required.", "Enter a valid email address."]},
        )
        assert parse_user_body({"name": "Robin", "email": "not-an-address"}) == (
            None,
            {"email": ["Enter a valid email address."]},
        )

    def test_reports_omitted_fields_exactly_as_the_references_formdata_does(
        self,
    ) -> None:
        assert parse_user_body({}) == (
            None,
            {
                "name": ["Invalid input: expected string, received null"],
                "email": ["Invalid input: expected string, received null"],
            },
        )
