# app/lib/fields.py
#
# The shared primitives every domain's body validator builds on: the zod
# type-check messages ("Invalid input: expected string, received null") and
# the JS coercion semantics zod's coerce rules apply, reproduced exactly so
# the validators' message strings match the reference variant's schemas
# verbatim. Pure by design — no database, no FastAPI.

from __future__ import annotations

import re
from typing import Any

# The reference's z.email() default — zod v4's "practical email validation"
# pattern, verbatim (node_modules/zod/v4/core/regexes.js) — so this API's
# idea of a valid address cannot drift from the reference's. Not an RFC
# grammar; the form's type="email" agreement.
EMAIL = re.compile(
    r"^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]"
    r"@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$"
)


def zod_received(value: Any) -> str:
    """The zod type name a value's Python type maps onto in a message."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, dict):
        return "object"
    if isinstance(value, list):
        return "array"
    return "unknown"


def zod_type_error(expected: str, value: Any) -> str:
    """zod's type-check message for a value that is not the expected type."""
    return f"Invalid input: expected {expected}, received {zod_received(value)}"


def is_string(value: Any) -> bool:
    """zod's string type gate: a str, and nothing else."""
    return isinstance(value, str)


def js_number(value: Any) -> float:
    """JS Number(), for the values a form control can submit.

    zod's `coerce.number()` runs the raw value through Number() before the
    checks: null and "" both coerce to 0, digit strings to their number, and
    anything unparseable to NaN. The messages the pinned tests carry come from
    that coercion, so it is reproduced here rather than approximated with
    Python's int().
    """
    if value is None:
        return 0.0
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        text = value.strip()
        if text == "":
            return 0.0
        try:
            return float(text)
        except ValueError:
            return float("nan")
    return float("nan")


def is_js_integer(number: float) -> bool:
    """zod's int() gate over a JS-coerced number (NaN is not an integer)."""
    return number == number and number == int(number)


def coerced_positive_int(value: Any) -> tuple[int, None] | tuple[None, str]:
    """zod's `z.coerce.number().int().positive()` for one field."""
    number = js_number(value)

    if number != number:  # NaN
        return None, "Invalid input: expected number, received nan"
    if number != int(number):
        return None, "Invalid input: expected number to be an integer"
    if number <= 0:
        return None, "Too small: expected number to be >0"

    return int(number), None
