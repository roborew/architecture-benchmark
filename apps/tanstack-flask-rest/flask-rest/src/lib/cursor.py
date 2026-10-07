# src/lib/cursor.py
#
# Keyset pagination cursor, ported verbatim from the reference variant
# (apps/tanstack-start-react/src/lib/cursor.ts) via the express variant
# (apps/tanstack-express-rest/express-rest/src/lib/cursor.ts).
#
# spec/queries.md: "an 'older' link carrying an opaque cursor for
# `(created_at, id)`; it must be stable and repeatable (same cursor -> same
# page)". Keyset rather than OFFSET so a page costs the same whether it is the
# first or the hundredth, and so an insert during paging cannot shift rows onto
# a page the reader has already seen.
#
# The tuple is packed into one base64url string because a raw
# `2026-09-28T10:15:00.000000Z|101` contains characters that would have to be
# percent-encoded in the `?cursor=` query parameter, and the contract calls the
# cursor opaque — the page should not need to know how it is packed. The
# encoding is byte-identical to the express variant's (unpadded base64url), so
# a page rendered by one variant pages correctly against the other.
#
# Pure by design: no database, no Flask, so the unit suite can pin the packing
# and the models can share it without either importing the other.

import base64
import binascii
import math
from dataclasses import dataclass

SEPARATOR = "|"


@dataclass(frozen=True)
class Cursor:
    """The ``(created_at, id)`` tuple a page starts after."""

    created_at: str
    id: int


def _js_number(raw: str) -> float:
    """JS ``Number()`` on the id half of a decoded cursor.

    The express variant decodes with ``Number()``, which accepts spellings
    Python's ``int()`` rejects ("1e2", surrounding whitespace). Mirroring the
    coercion keeps hand-edited cursors behaving identically across variants;
    anything unparsable comes back as NaN, which the caller treats as unusable.
    """
    try:
        return float(raw)
    except ValueError:
        return float("nan")


def encode_cursor(created_at: str, id: int) -> str:
    """Packs a cursor tuple into one opaque, query-string-safe string."""
    packed = f"{created_at}{SEPARATOR}{id}".encode("utf-8")
    return base64.urlsafe_b64encode(packed).decode("ascii").rstrip("=")


def decode_cursor(value: str | None) -> Cursor | None:
    """Decodes a cursor, or returns ``None`` when there is nothing usable.

    A malformed or hand-edited cursor yields ``None`` rather than raising: the
    model then reads the first page, which is a better outcome than a 500 for a
    link the user may have simply edited.
    """
    if not value:
        return None

    try:
        # base64 requires the padding the encoder stripped; tolerate either
        # alphabet on the way in, like node's "base64url".
        padded = value + "=" * (-len(value) % 4)
        decoded = base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8")
    except (binascii.Error, UnicodeError, ValueError):
        return None

    separator = decoded.rfind(SEPARATOR)
    if separator == -1:
        return None

    created_at = decoded[:separator]
    id_number = _js_number(decoded[separator + 1 :])

    if not created_at or not (id_number.is_integer() and math.isfinite(id_number)):
        return None

    return Cursor(created_at=created_at, id=int(id_number))
