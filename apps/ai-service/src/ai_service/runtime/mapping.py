"""Result mapping (stub)."""

from __future__ import annotations

from typing import Any

from llm_agent import ChatExchange, ChatResult

from ai_service.schemas import ResultReport


def report_for(
    result: ChatResult, *, grant: str, latency_ms: int, interrupted: bool = False
) -> ResultReport:
    raise NotImplementedError(result, grant, latency_ms, interrupted)


def history_for(history: list[Any]) -> list[ChatExchange]:
    raise NotImplementedError(history)
