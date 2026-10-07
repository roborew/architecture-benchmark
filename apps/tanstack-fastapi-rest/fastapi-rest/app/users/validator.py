# app/users/validator.py
#
# Input validation for the users surface, kept pure so it can be unit tested
# without FastAPI: the JSON body of create/update. The rules and their message
# strings are ported verbatim from the reference variant's UserSchema
# (apps/tanstack-start-react/src/lib/actions.ts), so a client that rendered
# the reference app's validation errors renders ours unchanged.

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.lib.fields import EMAIL, is_string, zod_type_error


@dataclass(frozen=True, slots=True)
class UserBodyFields:
    name: str
    email: str


def parse_user_body(
    raw: Any,
) -> tuple[UserBodyFields, None] | tuple[None, dict[str, list[str]]]:
    """Parses a create/update user body (`{ name, email }`).

    An absent field reads back as null — the same value the reference's
    formData.get returns for a field the form did not submit — so the type
    messages match the reference's one-for-one. Every check in a field's chain
    contributes its message, as zod collects every issue in the chain.
    """
    body = raw if isinstance(raw, dict) else {}

    errors: dict[str, list[str]] = {}

    # name: z.string().trim().min(1, "…").max(200, "…")
    name = body.get("name")
    if not is_string(name):
        errors["name"] = [zod_type_error("string", name)]
    else:
        name_errors: list[str] = []
        if len(name.strip()) < 1:
            name_errors.append("User name is required.")
        if len(name.strip()) > 200:
            name_errors.append("User name must be 200 characters or fewer.")
        if name_errors:
            errors["name"] = name_errors

    # email: z.string().trim().min(1, "…").email("…")
    # `users.email` has no UNIQUE constraint (spec/schema.sql) and
    # spec/contract.md requires none, so no uniqueness rule is imposed here —
    # two members may legitimately share an address. The address is still
    # shape-checked because the form declares type="email" and the server
    # should agree.
    email = body.get("email")
    if not is_string(email):
        errors["email"] = [zod_type_error("string", email)]
    else:
        email_errors: list[str] = []
        if len(email.strip()) < 1:
            email_errors.append("Email is required.")
        if not EMAIL.match(email.strip()):
            email_errors.append("Enter a valid email address.")
        if email_errors:
            errors["email"] = email_errors

    if errors:
        return None, errors

    return (
        UserBodyFields(name=body["name"].strip(), email=body["email"].strip()),
        None,
    )
