"""The bounded public read capabilities: the profile, projected as the `get_profile` tool sees it.

`ProfileCapability.read` returns the public profile view, `Busy` when `concurrency` reads already
run (it never queues), or `Unavailable` when the content read fails or passes `timeout_s`. It
reads public content only, needs no bearer and carries no generation or conversation data.
"""

from __future__ import annotations

import asyncio
from typing import Any

from llm_agent import ContentReader, ContentUnavailableError, profile_view


class Busy(Exception):
    """Every read slot is taken."""


class Unavailable(Exception):
    """The content could not be read in time."""


class ProfileCapability:
    def __init__(self, content: ContentReader, *, concurrency: int, timeout_s: float) -> None:
        self._content = content
        self._free = concurrency
        self._timeout_s = timeout_s

    async def read(self) -> dict[str, Any]:
        if self._free <= 0:
            raise Busy
        self._free -= 1
        try:
            async with asyncio.timeout(self._timeout_s):
                person = await self._content.read_person()
        except (TimeoutError, ContentUnavailableError) as error:
            raise Unavailable from error
        finally:
            self._free += 1
        return profile_view(person)
