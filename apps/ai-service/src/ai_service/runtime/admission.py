"""Admission: at most `slots` operations at once, a bounded wait for a slot, and a closed state.

`admit` waits at most `wait_s` for a free slot and returns a `Slot` the operation releases when
it ends, or None (busy) when no slot freed in time or admission is closed for a shutdown. A busy
answer has claimed nothing and called no model.
"""

from __future__ import annotations

import asyncio


class Slot:
    """One admitted operation's place; `release` frees it once, any later call does nothing."""

    def __init__(self, semaphore: asyncio.Semaphore) -> None:
        self._semaphore: asyncio.Semaphore | None = semaphore

    def release(self) -> None:
        if self._semaphore is not None:
            self._semaphore.release()
            self._semaphore = None


class Admission:
    def __init__(self, slots: int, wait_s: float) -> None:
        self._semaphore = asyncio.Semaphore(slots)
        self._wait_s = wait_s
        self._closed = False

    @property
    def closed(self) -> bool:
        return self._closed

    def close(self) -> None:
        """Admits nothing more; operations already admitted keep their slots."""
        self._closed = True

    async def admit(self) -> Slot | None:
        if self._closed:
            return None
        try:
            async with asyncio.timeout(self._wait_s):
                await self._semaphore.acquire()
        except TimeoutError:
            return None
        if self._closed:
            self._semaphore.release()
            return None
        return Slot(self._semaphore)
