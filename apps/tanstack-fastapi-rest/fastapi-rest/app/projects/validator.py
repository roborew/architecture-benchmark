# app/projects/validator.py
#
# Input validation for the projects surface, kept pure so it can be unit
# tested without FastAPI: the `q` search param (shared lib validator) and the
# JSON body of create/update. The rules and their message strings are ported
# verbatim from the reference variant's ProjectSchema
# (apps/tanstack-start-react/src/lib/actions.ts), so a client that rendered
# the reference app's validation errors renders ours unchanged.
#
# Note the asymmetry with tasks: the reference's ProjectSchema does NOT
# preprocess `description`, so a body that omits it is a validation failure
# ("Invalid input: expected string, received null") exactly as it is there.

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.lib.fields import is_string, zod_type_error


@dataclass(frozen=True, slots=True)
class ProjectBodyFields:
    name: str
    description: str


def parse_project_body(
    raw: Any,
) -> tuple[ProjectBodyFields, None] | tuple[None, dict[str, list[str]]]:
    """Parses a create/update project body (`{ name, description }`).

    An absent field reads back as null — the same value the reference's
    formData.get returns for a field the form did not submit — so the type
    messages match the reference's one-for-one.
    """
    body = raw if isinstance(raw, dict) else {}

    errors: dict[str, list[str]] = {}

    # name: z.string().trim().min(1, "…").max(200, "…")
    # The schema puts no limit on projects.name, but tasks.title caps at 200.
    name = body.get("name")
    if not is_string(name):
        errors["name"] = [zod_type_error("string", name)]
    else:
        name_errors: list[str] = []
        if len(name.strip()) < 1:
            name_errors.append("Project name is required.")
        if len(name.strip()) > 200:
            name_errors.append("Project name must be 200 characters or fewer.")
        if name_errors:
            errors["name"] = name_errors

    # description: z.string().trim() — no preprocess, so null is a type
    # failure, not silently an empty description.
    description = body.get("description")
    if not is_string(description):
        errors["description"] = [zod_type_error("string", description)]

    if errors:
        return None, errors

    return (
        ProjectBodyFields(
            name=body["name"].strip(), description=body["description"].strip()
        ),
        None,
    )
