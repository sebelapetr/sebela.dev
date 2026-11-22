"""The fictional model drives the real agent graph: the guard, sources and cards are real."""

from __future__ import annotations

import asyncio

from llm_agent import ApiContentReader, ChatAgent, ChatRequest, ChatResult, ExecutionLimits

from ai_service.models.fake import FakeModels
from tests.fakes import API_URL, PERSON_ID, FakeApi


async def ask(models: FakeModels, deadline_s: float = 60.0) -> ChatResult:
    api = FakeApi()
    async with ApiContentReader(API_URL, transport=api.transport()) as content:
        agent = ChatAgent(content=content, models=models)
        return await agent.run(
            ChatRequest(question="Who is Ilsa Marrow?"),
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
