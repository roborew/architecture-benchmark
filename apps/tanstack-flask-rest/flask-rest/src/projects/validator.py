# src/projects/projects.validator.py
#
# Input validation for the projects surface, kept pure so it can be unit
# tested without Flask: the `q` search param (shared lib validator) and the
# JSON body of create/update. The rules and their message strings are ported
# verbatim from the reference variant's ProjectSchema
# (apps/tanstack-start-react/src/lib/actions.ts), so a client that rendered
# the reference app's validation errors renders ours unchanged.
#
# Note the asymmetry with tasks: the reference's ProjectSchema does NOT
# preprocess `description`, so a body that omits it is a validation failure
# ("Invalid input: expected string, received null") exactly as it is there.

from dataclasses import dataclass
from typing import Any

from src.lib.validation import BodyErrors, string_field


@dataclass(frozen=True)
class ProjectBodyFields:
    name: str
    description: str


def parse_project_body(raw: Any) -> ProjectBodyFields | BodyErrors:
    """Parses a create/update project body (``{name, description}``).

    An absent field reads back as null — the same value the reference's
    formData.get returns for a field the form did not submit — so the type
    messages match the reference's one-for-one.
    """
    body = raw if isinstance(raw, dict) else {}
    errors: dict[str, list[str]] = {}

    name, name_errors = string_field(body.get("name"))
    if not name_errors:
        if len(name) < 1:
            name_errors = ["Project name is required."]
        # The schema puts no limit on projects.name, but tasks.title caps at
        # 200.
        elif len(name) > 200:
            name_errors = ["Project name must be 200 characters or fewer."]
    if name_errors:
        errors["name"] = name_errors

    description, description_errors = string_field(body.get("description"))
    if description_errors:
        errors["description"] = description_errors

    if errors:
        return BodyErrors(errors)

    return ProjectBodyFields(name=name, description=description)
