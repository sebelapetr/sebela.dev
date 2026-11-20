"""Scripted fakes for the agent's deterministic tests: models, the content reader and messages.

No test here calls a provider or the content API. A scripted model answers each stage call with
the next step of its stage's script: a message, an exception to raise, or an awaitable that never
finishes (to exercise deadlines and cancellation).
"""

from __future__ import annotations

import asyncio
import datetime
import json
from collections.abc import Sequence
from typing import Any

import anthropic
import httpx2
from langchain_core.messages import AIMessage, BaseMessage

from llm_agent import ContentUnavailableError, ModelCall, PublicLink, PublicPerson, PublicStep

PERSON_ID = "00000000-0000-4000-8000-000000000001"

PERSON = PublicPerson(
    id=PERSON_ID,
    name="Ilsa Marrow",
    headline="Fictional AI engineer for the LLM agent evals",
    short_bio="Ilsa Marrow is a fictional engineer who builds evaluated assistants.",
    long_bio="Ilsa Marrow does not exist; she focuses on retrieval and evaluation.",
    location="Port Wren",
    email="ilsa@marrow.example.test",
    links=[
        PublicLink(label="Website", url="https://marrow.example.test/"),
        PublicLink(label="Code", url="https://code.example.test/ilsa-marrow"),
    ],
    availability="Open to two days a week of consulting from March 2027.",
    career_started_on=datetime.date(2015, 9, 1),
    services_intro="Ilsa offers fictional reviews of chat assistants.",
    collaboration_steps=[PublicStep(title="Call", description="A short call.")],
    services_note="Fixture note: no prices are published.",
)

CONTACT = {
    "name": "Ilsa Marrow",
    "email": "ilsa@marrow.example.test",
    "links": [
        {"label": "Website", "url": "https://marrow.example.test/"},
        {"label": "Code", "url": "https://code.example.test/ilsa-marrow"},
    ],
}

USAGE = {"input_tokens": 1000, "output_tokens": 200, "total_tokens": 1200}


class Hang:
    """A model step that never returns; the agent must time it out or cancel it."""

    def __init__(self) -> None:
        self.started = asyncio.Event()


Step = BaseMessage | BaseException | Hang


class ScriptedModel:
    def __init__(self, owner: ScriptedModels, call: ModelCall) -> None:
        self.owner = owner
        self.call = call

    async def ainvoke(self, input: Sequence[BaseMessage]) -> BaseMessage:
        self.owner.calls.append((self.call, list(input)))
        script = self.owner.scripts[self.call.stage]
        if not script:
            raise AssertionError(f"unexpected {self.call.stage} call")
        step = script.pop(0)
        if isinstance(step, Hang):
            step.started.set()
            await asyncio.Event().wait()
            raise AssertionError("unreachable")
        if isinstance(step, BaseException):
            raise step
        return step


class ScriptedModels:
    """A model factory whose stage models play back a script per stage."""

    def __init__(self, *, security: Sequence[Step] = (), main: Sequence[Step] = ()) -> None:
        self.scripts: dict[str, list[Step]] = {"security": list(security), "main": list(main)}
        self.calls: list[tuple[ModelCall, list[BaseMessage]]] = []

    def __call__(self, call: ModelCall) -> ScriptedModel:
        return ScriptedModel(self, call)

    def stage_calls(self, stage: str) -> list[tuple[ModelCall, list[BaseMessage]]]:
        return [entry for entry in self.calls if entry[0].stage == stage]


class FakeContent:
    """The public person read, or a scripted failure."""

    def __init__(self, person: PublicPerson | None = PERSON, *, fail: bool = False) -> None:
        self.person = person
        self.fail = fail
        self.reads = 0

    async def read_person(self) -> PublicPerson:
        self.reads += 1
        if self.fail or self.person is None:
            raise ContentUnavailableError("the content API is unavailable")
        return self.person


def message(payload: dict[str, Any], **metadata: Any) -> AIMessage:
    return AIMessage(
        content=json.dumps(payload),
        usage_metadata=metadata.pop("usage", USAGE),
        response_metadata={"stop_reason": "end_turn", **metadata},
    )


def verdict(value: str = "ALLOW", category: str = "none", reason: str = "ok") -> AIMessage:
    return message({"verdict": value, "category": category, "reason_code": reason})


def draft(
    text: str = "Ilsa Marrow is a fictional engineer who builds evaluated assistants.",
    *,
    outcome: str = "answered",
    language: str = "en",
    refs: Sequence[str] = ("src-1",),
    show_contact: bool = False,
) -> AIMessage:
    return message(
        {
            "outcome": outcome,
            "language": language,
            "text": text,
            "source_refs": list(refs),
            "show_contact": show_contact,
        }
    )


def tools(*names: str, args: dict[str, Any] | None = None) -> AIMessage:
    return AIMessage(
        content="",
        tool_calls=[
            {"name": name, "args": dict(args or {}), "id": f"call-{index}", "type": "tool_call"}
            for index, name in enumerate(names, start=1)
        ],
        usage_metadata=USAGE,
        response_metadata={"stop_reason": "tool_use"},
    )


def refusal() -> AIMessage:
    return AIMessage(content="", usage_metadata=USAGE, response_metadata={"stop_reason": "refusal"})


_REQUEST = httpx2.Request("POST", "https://api.anthropic.test/v1/messages")


def status_error(status: int) -> anthropic.APIStatusError:
    response = httpx2.Response(status, request=_REQUEST)
    kinds: dict[int, type[anthropic.APIStatusError]] = {
        400: anthropic.BadRequestError,
        429: anthropic.RateLimitError,
        500: anthropic.InternalServerError,
        529: anthropic.InternalServerError,
    }
    return kinds.get(status, anthropic.APIStatusError)("failed", response=response, body=None)


def connection_error() -> anthropic.APIConnectionError:
    return anthropic.APIConnectionError(request=_REQUEST)


def spans(result: Any) -> list[tuple[str, str]]:
    return [(span.name, span.status) for span in result.trace]
