"""The bounded read capabilities: one page of a read tool, as the in-process agent projects it.

`ReadCapabilities.read(name, arguments, page)` returns the `llm_agent.read_tool` page for one of
`READ_CAPABILITIES` (every read tool but the contact read). It hides the bounds every read caller
shares: at most `rate` reads per sliding `window_s` (`RateLimited`, with the seconds until the
next slot), at most `concurrency` parallel reads (`Busy`; it never queues) and `timeout_s` for one
read (`Unavailable`). The name and the arguments are validated before any API read
(`NotAvailable`, `InvalidArguments`); a missing record is `NotFound`; an unreadable or oversized
result is `Unavailable`, never truncated. It reads public content only and holds no bearer.
"""

from __future__ import annotations

import asyncio
import math
import time
from collections import deque
from collections.abc import Callable, Mapping

from llm_agent import (
    ContentNotFoundError,
    ContentReader,
    ContentUnavailableError,
    InvalidToolArgumentsError,
    ToolNotAvailableError,
    ToolPage,
    ToolResultTooLargeError,
    read_tool,
)


class NotAvailable(Exception):
    """The name is not a read capability; nothing was read."""


class InvalidArguments(Exception):
    """The arguments or the page are not ones the capability takes; nothing was read."""


class NotFound(Exception):
    """The record the arguments name is not published."""


class Busy(Exception):
    """Every read slot is taken."""


class RateLimited(Exception):
    """The window's reads are spent; `retry_after_s` is the wait for the next slot."""

    def __init__(self, retry_after_s: int) -> None:
        super().__init__(retry_after_s)
        self.retry_after_s = retry_after_s


class Unavailable(Exception):
    """The content could not be read in time, or the result is over its bounds."""


class ReadCapabilities:
    def __init__(
        self,
        content: ContentReader,
        *,
        concurrency: int,
        timeout_s: float,
        rate: int,
        window_s: float,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._content = content
        self._free = concurrency
        self._timeout_s = timeout_s
        self._rate = rate
        self._window_s = window_s
        self._clock = clock
        self._reads: deque[float] = deque()

    async def read(self, name: str, arguments: Mapping[str, str], page: int) -> ToolPage:
        self._admit()
        if self._free <= 0:
            raise Busy
        self._free -= 1
        try:
            async with asyncio.timeout(self._timeout_s):
                return await read_tool(self._content, name, arguments, page=page)
        except ToolNotAvailableError as error:
            raise NotAvailable from error
        except InvalidToolArgumentsError as error:
            raise InvalidArguments from error
        except ContentNotFoundError as error:
            raise NotFound from error
        except (TimeoutError, ContentUnavailableError, ToolResultTooLargeError) as error:
            raise Unavailable from error
        finally:
            self._free += 1

    def _admit(self) -> None:
        now = self._clock()
        while self._reads and self._reads[0] + self._window_s <= now:
            self._reads.popleft()
        if len(self._reads) >= self._rate:
            raise RateLimited(max(1, math.ceil(self._reads[0] + self._window_s - now)))
        self._reads.append(now)
