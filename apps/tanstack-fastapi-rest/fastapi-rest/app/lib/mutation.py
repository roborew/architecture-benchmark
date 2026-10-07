# app/lib/mutation.py
#
# The write endpoints' success envelope, shared by every domain:
#
#   { "ok": true, "message": "...", "redirectTo": "..." }
#
# `redirectTo` is the route the SPA navigates to after the same mutation;
# `message` is the user-visible success string. A reply without a
# `redirectTo` (adding a comment) means: stay on this page and refresh — so
# `message` and `redirectTo` are optional and excluded when unset, which is
# how the reference's `createComment` reply (`{ ok: true }` only) is spelled.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field


class MutationResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    ok: bool = True
    message: str | None = None
    redirect_to: Annotated[str | None, Field(alias="redirectTo")] = None
