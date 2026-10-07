# app/lib/cursor.py
#
# Keyset pagination cursor, ported verbatim from the reference variant
# (apps/tanstack-start-react/src/lib/cursor.ts) via the Express variant.
#
# spec/queries.md: "an 'older' link carrying an opaque cursor for
# `(created_at, id)`; it must be stable and repeatable (same cursor → same
# page)". Keyset rather than OFFSET so a page costs the same whether it is the
# first or the hundredth, and so an insert during paging cannot shift rows onto
# a page the reader has already seen.
#
# The tuple is packed into one base64url string because a raw
# `2026-09-28T10:15:00.000000Z|101` contains characters that would have to be
# percent-encoded in the `?cursor=` query parameter, and the contract calls the
# cursor opaque — the page should not need to know how it is packed.
#
# Pure by design: no database, no FastAPI, so the unit suite can pin the packing
# and the models can share it without either importing the other.

from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass

SEPARATOR = "|"


@dataclass(frozen=True, slots=True)
class Cursor:
    created_at: str
    id: int


def encode_cursor(created_at: str, id: int) -> str:
    """Packs an `(created_at, id)` tuple into one opaque base64url string."""
    payload = f"{created_at}{SEPARATOR}{id}".encode("utf-8")
    # Node's "base64url" encoding emits no padding; strip it so cursors are
    # byte-identical with the reference variant's.
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def decode_cursor(value: str | None) -> Cursor | None:
    """Decodes a cursor, or returns None when there is nothing usable to decode.

    A malformed or hand-edited cursor yields None rather than raising: the
    model then reads the first page, which is a better outcome than a 500 for
    a link the user may have simply edited.
    """
    if not value:
        return None

    try:
        # urlsafe_b64decode ignores characters outside the alphabet (as Node's
        # base64url decoder does), so garbage degrades to junk bytes or a
        # decode error — both handled below.
        padded = value + "=" * (-len(value) % 4)
        decoded = base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8")
    except (binascii.Error, UnicodeDecodeError, ValueError):
        return None

    separator = decoded.rfind(SEPARATOR)
    if separator == -1:
        return None

    created_at = decoded[:separator]
    raw_id = decoded[separator + len(SEPARATOR) :]

    # JS Number(): an integer string decodes, anything else is NaN and fails
    # the integer test. Python's int() draws the same line for every value a
    # real cursor can carry.
    try:
        id = int(raw_id)
    except ValueError:
        return None

    if not created_at:
        return None

    return Cursor(created_at=created_at, id=id)
