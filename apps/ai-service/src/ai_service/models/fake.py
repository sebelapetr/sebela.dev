"""The fictional model: it drives the real agent graph without a provider and without a cost.

It answers every Security call with a verdict and every Main call with either a `get_profile`
tool call (before any tool result) or a draft that cites the first source (after one), so the
Output Guard, the sources and the cards are the agent's real ones. Each reply is decided from the
conversation it is given, so concurrent executions never share state. The scenario is server
configuration (`AI_SERVICE_FAKE_SCENARIO`), never a request field. `calls` counts every call, so a
test can assert that no second model call happened.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Sequence
from typing import Literal

import anthropic
import httpx2
from langchain_core.messages import AIMessage, BaseMessage, ToolMessage
from llm_agent import ChatModel, ModelCall

Scenario = Literal["answer", "slow", "refuse", "fail"]

#: The fictional token counts of every reply; they give the agent a small, real cost to count.
_USAGE = {"input_tokens": 1000, "output_tokens": 200, "total_tokens": 1200}

_ALLOW = {"verdict": "ALLOW", "category": "none", "reason_code": "ok"}
_BLOCK = {"verdict": "BLOCK", "category": "injection", "reason_code": "fake_refusal"}

_DRAFT = {
    "outcome": "answered",
    "language": "en",
    "text": "Ilsa Marrow is a fictional engineer who builds evaluated assistants.",
    "source_refs": ["src-1"],
    "show_contact": False,
    "unpublished": False,
}


def _reply(content: object, stop_reason: str, **fields: object) -> AIMessage:
    text = content if isinstance(content, str) else json.dumps(content)
    return AIMessage(
        content=text,
        usage_metadata=_USAGE,
        response_metadata={"stop_reason": stop_reason},
        **fields,
    )


def _provider_failure() -> anthropic.InternalServerError:
    request = httpx2.Request("POST", "https://api.anthropic.test/v1/messages")
    return anthropic.InternalServerError(
        "fictional provider failure", response=httpx2.Response(503, request=request), body=None
    )


class _FakeModel:
    def __init__(self, owner: FakeModels, call: ModelCall) -> None:
        self._owner = owner
        self._call = call

    async def ainvoke(self, input: Sequence[BaseMessage]) -> BaseMessage:
        owner = self._owner
        owner.calls.append(self._call.stage)
        if self._call.stage == "security":
            return await owner.security()
        if any(isinstance(message, ToolMessage) for message in input):
            return _reply(_DRAFT, "end_turn")
        tool_call = {"name": "get_profile", "args": {}, "id": "call-1", "type": "tool_call"}
        return _reply("", "tool_use", tool_calls=[tool_call])


class FakeModels:
    """A `ModelFactory` of the fictional model for one scenario.

    `answer` answers from the profile; `slow` waits in the Security call for `gate` (forever
    without one) and then answers; `refuse` is blocked by the Security stage; `fail` raises a
    transient provider error on every call, so the agent ends `unavailable`.
    """

    def __init__(self, scenario: Scenario = "answer", *, gate: asyncio.Event | None = None) -> None:
        self.scenario: Scenario = scenario
        self.gate = gate
        #: The stage of every model call, in order.
        self.calls: list[str] = []

    def __call__(self, call: ModelCall) -> ChatModel:
        return _FakeModel(self, call)

    async def security(self) -> BaseMessage:
        if self.scenario == "fail":
            raise _provider_failure()
        if self.scenario == "refuse":
            return _reply(_BLOCK, "end_turn")
        if self.scenario == "slow":
            await (self.gate or asyncio.Event()).wait()
        return _reply(_ALLOW, "end_turn")
