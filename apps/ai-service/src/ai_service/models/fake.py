"""The fictional model (stub)."""

from __future__ import annotations

import asyncio

from llm_agent import ChatModel, ModelCall


class FakeModels:
    def __init__(self, scenario: str = "answer", *, gate: asyncio.Event | None = None) -> None:
        self.scenario = scenario
        self.gate = gate
        self.calls: list[str] = []

    def __call__(self, call: ModelCall) -> ChatModel:
        raise NotImplementedError(call)
