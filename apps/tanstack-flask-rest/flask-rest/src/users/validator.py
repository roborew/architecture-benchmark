# src/users/users.validator.py
#
# Input validation for the users surface, kept pure so it can be unit tested
# without Flask: the JSON body of create/update. The rules and their message
# strings are ported verbatim from the reference variant's UserSchema
# (apps/tanstack-start-react/src/lib/actions.ts), so a client that rendered
# the reference app's validation errors renders ours unchanged.

from dataclasses import dataclass
from typing import Any

from src.lib.validation import BodyErrors, is_email, string_field


@dataclass(frozen=True)
class UserBodyFields:
    name: str
    email: str


def parse_user_body(raw: Any) -> UserBodyFields | BodyErrors:
    """Parses a create/update user body (``{name, email}``).

    An absent field reads back as null — the same value the reference's
    formData.get returns for a field the form did not submit — so the type
    messages match the reference's one-for-one. An empty email fails both the
    min rule and the format rule: zod collects every issue in the chain, and
    so does the reference's parse of an empty submitted field.

    `users.email` has no UNIQUE constraint (spec/schema.sql) and
    spec/contract.md requires none, so no uniqueness rule is imposed here —
    two members may legitimately share an address. The address is still
    shape-checked because the form declares `type="email"` and the server
    should agree.
    """
    body = raw if isinstance(raw, dict) else {}
    errors: dict[str, list[str]] = {}

    name, name_errors = string_field(body.get("name"))
    if not name_errors:
        if len(name) < 1:
            name_errors = ["User name is required."]
        elif len(name) > 200:
            name_errors = ["User name must be 200 characters or fewer."]
    if name_errors:
        errors["name"] = name_errors

    email, email_errors = string_field(body.get("email"))
    if not email_errors:
        if len(email) < 1:
            email_errors.append("Email is required.")
        if not is_email(email):
            email_errors.append("Enter a valid email address.")
    if email_errors:
        errors["email"] = email_errors

    if errors:
        return BodyErrors(errors)

    return UserBodyFields(name=name, email=email)
