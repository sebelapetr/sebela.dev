"""The per-execution trace: one span per stage, model attempt, tool call and guard decision.

Spans carry names, statuses, start offsets, durations and small typed attributes only, never
visitor text, model text or tool data.
"""

from __future__ import annotations

import time

from llm_agent.schemas import Span

Attribute = str | int | float | bool | None


class Tracer:
    def __init__(self) -> None:
        self.spans: list[Span] = []
        self._origin = time.monotonic()

    @staticmethod
    def start() -> float:
        return time.monotonic()

    def finish(self, name: str, status: str, started: float, **attributes: Attribute) -> None:
        duration = round((time.monotonic() - started) * 1000)
        offset = max(round((started - self._origin) * 1000), 0)
        self.spans.append(
            Span(
                name=name,
                status=status,
                start_ms=offset,
                duration_ms=duration,
                attributes=attributes,
            )
        )
