"""Typed reasons an execution stops before an approved answer: each maps to one fixed outcome."""

from __future__ import annotations

from typing import Literal

StopOutcome = Literal["unavailable", "limit_reached", "cancelled"]


class ExecutionStopped(Exception):
    """Raised inside the pipeline; the agent turns it into a fixed response."""

    outcome: StopOutcome = "unavailable"

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class Unavailable(ExecutionStopped):
    outcome = "unavailable"


class LimitReached(ExecutionStopped):
    outcome = "limit_reached"


class Cancelled(ExecutionStopped):
    outcome = "cancelled"

    def __init__(self) -> None:
        super().__init__("cancelled")
