"""The fictional model: it drives the real agent graph without a provider and without a cost.

It answers every Security call with a verdict and every Main call with either a `get_profile`
tool call (before any tool result) or a draft that cites the first source (after one), so the
Output Guard, the sources and the cards are the agent's real ones. Each reply is decided from the
conversation it is given, so concurrent executions never share state. The scenario is server
configuration (`AI_SERVICE_FAKE_SCENARIO`), never a request field. `calls` counts every call, so a
test can assert that no second model call happened; a test in another process reads the same from
the calls file (`AI_SERVICE_FAKE_CALLS_FILE`), and opens the `slow` gate by creating the gate file
(`AI_SERVICE_FAKE_GATE_FILE`). A question that asks about contact is answered with the contact card.
A compaction call (the summary schema, no tools) is answered with a short fictional summary in the
requested language that cites no record.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Sequence
from pathlib import Path
from typing import Literal

import anthropic
import httpx2
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage
from llm_agent import ChatModel, ModelCall

Scenario = Literal["answer", "slow", "refuse", "fail"]

#: The fictional token counts of every reply; they give the agent a small, real cost to count.
_USAGE = {"input_tokens": 1000, "output_tokens": 200, "total_tokens": 1200}

_ALLOW = {"verdict": "ALLOW", "category": "none", "reason_code": "ok"}
_BLOCK = {"verdict": "BLOCK", "category": "injection", "reason_code": "fake_refusal"}

#: How the agent marks the visitor's question and each earlier exchange in its prompts.
_QUESTION_TAG = "<visitor_question>"
_EXCHANGE_TAG = "<visitor_exchange>"
#: How often the `slow` scenario looks for its gate file.
_GATE_POLL_S = 0.05

#: How the compaction prompt names the language of the summary it asks for.
_SUMMARY_LANGUAGE = "Return the summary in the language "


def _summary(language: str) -> dict[str, object]:
    return {
        "language": language,
        "goals": ["Learn what the fictional engineer builds."],
        "open_questions": [],
        "covered": ["The fictional engineer's evaluated assistants."],
        "visitor_claims": [],
        "references": [],
    }


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
        visitor = "\n".join(
            message.content
            for message in input
            if isinstance(message, HumanMessage) and isinstance(message.content, str)
        )
        owner.record(self._call.stage, visitor.count(_EXCHANGE_TAG), visitor)
        if self._call.stage == "security":
            return await owner.security()
        if "open_questions" in self._call.response_schema.get("properties", {}):
            return await owner.compaction(visitor)
        if any(isinstance(message, ToolMessage) for message in input):
            question = visitor.rpartition(_QUESTION_TAG)[2]
            return _reply({**_DRAFT, "show_contact": "contact" in question.lower()}, "end_turn")
        tool_call = {"name": "get_profile", "args": {}, "id": "call-1", "type": "tool_call"}
        return _reply("", "tool_use", tool_calls=[tool_call])


class FakeModels:
    """A `ModelFactory` of the fictional model for one scenario.

    `answer` answers from the profile; `slow` waits in the Security call for `gate` or until
    `gate_file` exists (forever without either) and then answers; `refuse` is blocked by the
    Security stage; `fail` raises a transient provider error on every call, so the agent ends
    `unavailable` (a compaction `failed`). A compaction waits for the same gate in `slow`.
    """

    def __init__(
        self,
        scenario: Scenario = "answer",
        *,
        gate: asyncio.Event | None = None,
        calls_file: Path | None = None,
        gate_file: Path | None = None,
    ) -> None:
        self.scenario: Scenario = scenario
        self.gate = gate
        self.calls_file = calls_file
        self.gate_file = gate_file
        #: The stage of every model call, in order.
        self.calls: list[str] = []
        #: The stage and the visitor-side prompt text of every model call, in order.
        self.prompts: list[tuple[str, str]] = []

    def record(self, stage: str, history: int, prompt: str = "") -> None:
        """Counts one call; with a calls file, also appends its stage and history length."""
        self.calls.append(stage)
        self.prompts.append((stage, prompt))
        if self.calls_file is not None:
            with self.calls_file.open("a", encoding="utf-8") as calls:
                calls.write(json.dumps({"stage": stage, "history": history}) + "\n")

    def __call__(self, call: ModelCall) -> ChatModel:
        return _FakeModel(self, call)

    async def security(self) -> BaseMessage:
        if self.scenario == "fail":
            raise _provider_failure()
        if self.scenario == "refuse":
            return _reply(_BLOCK, "end_turn")
        if self.scenario == "slow":
            await self._gate_opens()
        return _reply(_ALLOW, "end_turn")

    async def compaction(self, prompt: str) -> BaseMessage:
        if self.scenario == "fail":
            raise _provider_failure()
        if self.scenario == "slow":
            await self._gate_opens()
        language = prompt.rpartition(_SUMMARY_LANGUAGE)[2][:2]
        return _reply(_summary(language if language in ("en", "cs") else "en"), "end_turn")

    async def _gate_opens(self) -> None:
        if self.gate_file is None:
            await (self.gate or asyncio.Event()).wait()
            return
        # Another process opens the gate, so it is watched, not awaited.
        while True:
            if self.gate_file.exists() or (self.gate is not None and self.gate.is_set()):
                return
            await asyncio.sleep(_GATE_POLL_S)
