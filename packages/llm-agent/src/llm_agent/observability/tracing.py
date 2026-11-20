"""The per-execution trace: one span per stage, tool call and guard decision, appended when done.

Spans carry names, statuses, durations and small typed attributes only, never visitor text, model
text or tool data.
"""

from __future__ import annotations

import time

from llm_agent.schemas import Span

Attribute = str | int | float | bool | None


class Tracer:
    def __init__(self) -> None:
        self.spans: list[Span] = []

    @staticmethod
    def start() -> float:
        return time.monotonic()

    def finish(self, name: str, status: str, started: float, **attributes: Attribute) -> None:
        duration = round((time.monotonic() - started) * 1000)
        self.spans.append(
            Span(name=name, status=status, duration_ms=duration, attributes=attributes)
        )
