"""The fictional model drives the real agent graph: the guard, sources and cards are real."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Sequence
from pathlib import Path

from llm_agent import (
    ApiContentReader,
    ChatAgent,
    ChatExchange,
    ChatRequest,
    ChatResult,
    ExecutionLimits,
)

from ai_service.models.fake import FakeModels
from tests.fakes import API_URL, PERSON_ID, FakeApi


async def ask(
    models: FakeModels,
    deadline_s: float = 60.0,
    history: Sequence[ChatExchange] = (),
    question: str = "Who is Ilsa Marrow?",
) -> ChatResult:
    api = FakeApi()
    async with ApiContentReader(API_URL, transport=api.transport()) as content:
        agent = ChatAgent(content=content, models=models)
        return await agent.run(
            ChatRequest(question=question, history=tuple(history)),
            limits=ExecutionLimits(deadline_s=deadline_s),
        )


async def test_the_answer_scenario_is_a_cited_answer_from_the_profile_tool() -> None:
    models = FakeModels("answer")
    result = await ask(models)
    assert result.outcome == "answered"
    assert [(source.kind, source.record_id) for source in result.sources] == [
        ("profile", PERSON_ID)
    ]
    assert "Ilsa Marrow" in result.text
    assert models.calls == ["security", "main", "main"]


async def test_the_refuse_scenario_is_refused_by_the_security_stage() -> None:
    models = FakeModels("refuse")
    result = await ask(models)
    assert result.outcome == "refused"
    assert models.calls == ["security"]


async def test_the_fail_scenario_is_unavailable() -> None:
    models = FakeModels("fail")
    result = await ask(models)
    assert result.outcome == "unavailable"
    assert models.calls
    assert set(models.calls) == {"security"}


async def test_the_slow_scenario_waits_for_its_gate() -> None:
    gate = asyncio.Event()
    models = FakeModels("slow", gate=gate)
    task = asyncio.ensure_future(ask(models))
    await asyncio.sleep(0.2)
    assert not task.done()
    gate.set()
    result = await task
    assert result.outcome == "answered"


async def test_the_slow_scenario_without_a_gate_runs_into_the_deadline() -> None:
    models = FakeModels("slow")
    result = await ask(models, deadline_s=0.5)
    assert result.outcome == "limit_reached"
    assert result.reason == "deadline"


async def test_a_calls_file_receives_one_json_line_per_model_call(tmp_path: Path) -> None:
    calls_file = tmp_path / "calls.jsonl"
    models = FakeModels("answer", calls_file=calls_file)
    await ask(models)
    lines = [json.loads(line) for line in calls_file.read_text().splitlines()]
    assert lines == [
        {"stage": "security", "history": 0},
        {"stage": "main", "history": 0},
        {"stage": "main", "history": 0},
    ]


async def test_a_calls_file_counts_the_history_exchanges_the_model_saw(tmp_path: Path) -> None:
    calls_file = tmp_path / "calls.jsonl"
    models = FakeModels("answer", calls_file=calls_file)
    history = [
        ChatExchange(question="Who is Ilsa Marrow?", answer="A fictional engineer.", language="en")
    ]
    await ask(models, history=history)
    lines = [json.loads(line) for line in calls_file.read_text().splitlines()]
    assert [line["history"] for line in lines] == [1, 1, 1]


async def test_the_slow_scenario_waits_for_its_gate_file(tmp_path: Path) -> None:
    gate_file = tmp_path / "gate"
    models = FakeModels("slow", gate_file=gate_file)
    task = asyncio.ensure_future(ask(models))
    await asyncio.sleep(0.3)
    assert not task.done()
    gate_file.touch()
    result = await asyncio.wait_for(task, timeout=10)
    assert result.outcome == "answered"


async def test_a_question_about_contact_is_answered_with_the_contact_card() -> None:
    result = await ask(FakeModels("answer"), question="How can I contact Ilsa Marrow?")
    assert result.outcome == "answered"
    assert result.contact is not None
    assert result.contact.email == "ilsa@marrow.example.test"


async def test_a_contact_word_in_the_history_alone_shows_no_card() -> None:
    history = [ChatExchange(question="How can I contact her?", answer="By email.", language="en")]
    result = await ask(FakeModels("answer"), history=history)
    assert result.contact is None
