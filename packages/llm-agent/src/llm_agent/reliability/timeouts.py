"""The execution deadline and the per-attempt timeouts bounded by it."""

from __future__ import annotations

import time


class Deadline:
    def __init__(self, seconds: float) -> None:
        self._ends = time.monotonic() + seconds

    def remaining(self) -> float:
        return max(self._ends - time.monotonic(), 0.0)

    def bounded(self, seconds: float) -> float:
        """A step's own timeout, never past the execution deadline."""
        return min(seconds, self.remaining())

    @property
    def expired(self) -> bool:
        return self.remaining() <= 0.0
