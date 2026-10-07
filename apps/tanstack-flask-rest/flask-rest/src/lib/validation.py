# src/lib/validation.py
#
# The shared machinery of the pure body validators: the zod-parity primitives.
#
# The reference variant validates with zod (apps/tanstack-start-react/src/lib/
# actions.ts) and its message strings are part of the API contract — a client
# that rendered the reference app's validation errors must render ours
# unchanged. Python has no zod, so the handful of coercions and messages the
# reference's schemas actually produce are reproduced here, exactly:
#
#   * a field the client did not submit reads back as null, and zod's own type
#     message ("Invalid input: expected string, received null") is part of that
#     contract — so the type-name helper spells values the way JS does;
#   * ``z.coerce.number()`` runs JS ``Number()`` first, where ``Number(null)``
#     is 0 (not NaN) and ``Number("2")`` is 2 — mirrored by ``js_number``;
#   * the check messages ("Too small: expected number to be >0", ...) are zod
#     v4's own strings, pinned by the express variant's unit suite.
#
# Pure by design: no database, no Flask, so every rule is unit-testable alone.

import re
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class BodyErrors:
    """The failure half of a body parse: the field -> messages map.

    The success half is each validator's own fields dataclass, so a controller
    checks ``isinstance(parsed, BodyErrors)`` and wraps the map into its 400
    envelope — plain data, decided before any HTTP is involved.
    """

    errors: dict[str, list[str]]


def js_type_name(value: Any) -> str:
    """The type name a zod message would print for this value."""
    if value is None:
        return "null"
    if isinstance(value, bool):  # before int: bool is an int subclass in Python
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "Array"
    if isinstance(value, dict):
        return "Object"
    return type(value).__name__


def js_number(value: Any) -> float:
    """JS ``Number()``: the coercion ``z.coerce.number()`` applies first.

    ``Number(null)`` is 0 — which then fails a ``positive()`` check with the
    "Too small" message rather than a type error — and ``Number("")`` is 0 too;
    anything unparsable is NaN.
    """
    if value is None:
        return 0.0
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        stripped = value.strip()
        if stripped == "":
            return 0.0
        try:
            return float(stripped)
        except ValueError:
            return float("nan")
    return float("nan")


def string_field(value: Any) -> tuple[str, list[str]]:
    """zod's ``z.string().trim()`` on one field: the trimmed value, or the
    type message a non-string (typically the null of an unsubmitted field)
    produces. The min/max/format rules are the caller's, in chain order."""
    if not isinstance(value, str):
        return "", [f"Invalid input: expected string, received {js_type_name(value)}"]
    return value.strip(), []


# The email shape the reference's z.email() accepts: no whitespace, one @,
# and a dotted domain. The reference's own regex is looser in corners no
# benchmark fixture exercises; this one agrees with it on every value the
# suites pin ("robin@example.test" valid, "not-an-address" not).
_EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def is_email(value: str) -> bool:
    """zod's ``z.email()`` on an already-trimmed value."""
    return _EMAIL_PATTERN.fullmatch(value) is not None
