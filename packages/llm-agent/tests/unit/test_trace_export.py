"""The trace export (#214): span timing, the compaction record and the metadata-only OTLP payload.

`otlp_trace` turns one `ExecutionRecord` into the OTLP/JSON body Langfuse ingests: one root span
for the operation and a nested span per stage, model attempt, tool call and guard decision, with
only allowlisted, rule-masked attributes. No visitor text, model text or tool data is in a record,
and the builder adds none; every value here is fictional.
"""

from __future__ import annotations

import json
from typing import Any

import pytest

from llm_agent import (
    ChatAgent,
    ChatExchange,
    ChatRequest,
    CompactionRequest,
    ExecutionRecord,
    Span,
    Usage,
    otlp_trace,
    versions,
)
from tests.unit.fakes import FakeContent, ScriptedModels, draft, message, tools, verdict

EN = "Who is Ilsa Marrow? Mail me at tomas.herrera@northwind.example.com."
TRACE = "4bf92f3577b34da6a3ce929d0e0e4736"
ENDED = 1_800_000_000_000_000_000


class Recorder:
    def __init__(self) -> None:
        self.records: list[ExecutionRecord] = []

    def export(self, record: ExecutionRecord) -> None:
        self.records.append(record)


async def answered() -> ExecutionRecord:
    sink = Recorder()
    models = ScriptedModels(security=[verdict()], main=[tools("get_profile"), draft()])
    agent = ChatAgent(content=FakeContent(), models=models, telemetry=sink)
    await agent.run(ChatRequest(question=EN))
    (record,) = sink.records
    return record


def record(spans: list[Span], **fields: Any) -> ExecutionRecord:
    values: dict[str, Any] = {
        "execution_id": None,
        "trace_id": None,
        "operation": "answer",
        "outcome": "answered",
        "reason": None,
        "language": "en",
        "usage": Usage(model_attempts=1, input_tokens=900, output_tokens=120, cost_usd=0.004),
        "versions": versions(),
        "spans": spans,
    }
    values.update(fields)
    return ExecutionRecord(**values)


def build(item: ExecutionRecord, **options: Any) -> dict[str, Any]:
    arguments: dict[str, Any] = {
        "trace_id": TRACE,
        "ended_at_ns": ENDED,
        "service": "sebela-ai-service",
        "environment": "development",
    }
    arguments.update(options)
    return otlp_trace(item, **arguments)


def exported_spans(payload: dict[str, Any]) -> list[dict[str, Any]]:
    (resource,) = payload["resourceSpans"]
    (scope,) = resource["scopeSpans"]
    spans: list[dict[str, Any]] = scope["spans"]
    return spans


def attributes(span: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for attribute in span["attributes"]:
        (value,) = attribute["value"].values()
        result[attribute["key"]] = value
    return result


def by_name(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {span["name"]: span for span in exported_spans(payload)}


# --- Span timing ---------------------------------------------------------------------------------


async def test_every_span_records_its_start_within_the_execution() -> None:
    spans = {span.name: span for span in (await answered()).spans}
    security, main = spans["stage.security"], spans["stage.main"]
    assert security.start_ms >= 0
    assert main.start_ms >= security.start_ms
    for name in ("model.main", "tool.get_profile"):
        child = spans[name]
        assert main.start_ms <= child.start_ms
        assert child.start_ms + child.duration_ms <= main.start_ms + main.duration_ms + 1


def test_a_span_without_a_start_reads_as_starting_at_zero() -> None:
    assert Span(name="stage.main", status="ok", duration_ms=3).start_ms == 0


# --- The operation's record ----------------------------------------------------------------------


async def test_an_answer_exports_a_record_of_the_answer_operation() -> None:
    assert (await answered()).operation == "answer"


async def test_a_compaction_exports_a_record_of_the_compact_operation() -> None:
    sink = Recorder()
    summary = {
        "language": "en",
        "goals": ["Assess Ilsa's evaluation work"],
        "open_questions": [],
        "covered": ["The evaluation harness"],
        "visitor_claims": ["Lives at 3 Harbour Steps, call +44 20 7946 0958"],
        "references": [],
    }
    agent = ChatAgent(
        content=FakeContent(), models=ScriptedModels(main=[message(summary)]), telemetry=sink
    )
    exchanges = tuple(
        ChatExchange(question=f"Question {n}? {EN}", answer=f"Answer {n}.", language="en")
        for n in range(1, 5)
    )
    result = await agent.compact(CompactionRequest(exchanges=exchanges, execution_id="op-1"))
    (item,) = sink.records
    assert item.operation == "compact"
    assert item.outcome == result.outcome == "compacted"
    assert item.execution_id == "op-1"
    assert item.usage == result.usage
    assert item.spans == result.trace
    text = json.dumps(item.model_dump(mode="json"))
    for value in ("Harbour Steps", "7946 0958", "tomas.herrera", "Question 1"):
        assert value not in text


async def test_a_failing_sink_changes_no_compaction() -> None:
    class Broken:
        def export(self, record: ExecutionRecord) -> None:
            raise RuntimeError("the exporter is down")

    agent = ChatAgent(content=FakeContent(), models=ScriptedModels(), telemetry=Broken())
    exchange = ChatExchange(question="Hi?", answer="Hello.", language="en")
    result = await agent.compact(CompactionRequest(exchanges=(exchange,)))
    assert result.outcome == "unchanged"


# --- The OTLP payload ----------------------------------------------------------------------------


async def test_the_payload_nests_stage_model_and_tool_spans_under_one_root() -> None:
    payload = build(await answered())
    spans = exported_spans(payload)
    roots = [span for span in spans if "parentSpanId" not in span]
    (root,) = roots
    assert root["name"] == "chat.answer"
    assert {span["traceId"] for span in spans} == {TRACE}
    assert len({span["spanId"] for span in spans}) == len(spans)
    named = by_name(payload)
    root_id = root["spanId"]
    assert named["stage.security"]["parentSpanId"] == root_id
    assert named["stage.main"]["parentSpanId"] == root_id
    assert named["model.security"]["parentSpanId"] == named["stage.security"]["spanId"]
    assert named["model.main"]["parentSpanId"] == named["stage.main"]["spanId"]
    assert named["tool.get_profile"]["parentSpanId"] == named["stage.main"]["spanId"]
    assert int(root["endTimeUnixNano"]) == ENDED
    for span in spans:
        assert int(root["startTimeUnixNano"]) <= int(span["startTimeUnixNano"])
        assert int(span["startTimeUnixNano"]) <= int(span["endTimeUnixNano"]) <= ENDED


async def test_spans_carry_langfuse_types_models_usage_and_the_outcome() -> None:
    item = await answered()
    named = by_name(build(item))
    model = attributes(named["model.main"])
    assert model["langfuse.observation.type"] == "generation"
    assert model["langfuse.observation.model.name"] == versions().main_model
    usage = json.loads(model["langfuse.observation.usage_details"])
    assert usage == {"input": 1000, "output": 200}
    assert attributes(named["tool.get_profile"])["langfuse.observation.type"] == "tool"
    assert attributes(named["stage.security"])["langfuse.observation.type"] == "guardrail"
    assert attributes(named["stage.output"])["langfuse.observation.type"] == "guardrail"
    assert attributes(named["stage.main"])["langfuse.observation.type"] == "agent"
    root = attributes(named["chat.answer"])
    assert root["langfuse.trace.name"] == "chat.answer"
    assert root["langfuse.trace.metadata.outcome"] == "answered"
    assert root["langfuse.trace.metadata.language"] == "en"
    assert root["langfuse.trace.metadata.main_model"] == versions().main_model
    assert root["langfuse.trace.metadata.chat_prompt"] == versions().chat_prompt
    assert root["langfuse.environment"] == "development"
    assert root["langfuse.version"] == versions().package
    usage = json.loads(root["langfuse.trace.metadata.usage"])
    assert usage["model_attempts"] == item.usage.model_attempts == 3
    assert usage["cost_uncertain"] is item.usage.cost_uncertain
    cost = json.loads(root["langfuse.observation.cost_details"])
    assert cost == {"total": item.usage.cost_usd}


def test_failed_attempts_and_retries_are_visible_as_levels_and_attempts() -> None:
    spans = [
        Span(name="stage.main", status="error", start_ms=0, duration_ms=40),
        Span(
            name="model.main",
            status="transient_error",
            start_ms=1,
            duration_ms=10,
            attributes={"model": "claude-x", "attempt": 1, "input_tokens": None},
        ),
        Span(
            name="model.main",
            status="timeout",
            start_ms=15,
            duration_ms=20,
            attributes={"model": "claude-x", "attempt": 2},
        ),
    ]
    item = record(spans, outcome="unavailable", reason="model_unavailable")
    exported = exported_spans(build(item))
    models = [attributes(span) for span in exported if span["name"] == "model.main"]
    assert [m["langfuse.observation.metadata.attempt"] for m in models] == ["1", "2"]
    assert [m["langfuse.observation.level"] for m in models] == ["WARNING", "ERROR"]
    assert [m["langfuse.observation.status_message"] for m in models] == [
        "transient_error",
        "timeout",
    ]
    assert all(span["status"]["code"] == 2 for span in exported if span["name"] != "chat.answer")
    root = attributes(next(span for span in exported if span["name"] == "chat.answer"))
    assert root["langfuse.trace.metadata.reason"] == "model_unavailable"


def test_a_compaction_payload_has_its_own_root_and_a_chain_span() -> None:
    spans = [
        Span(name="model.main", status="ok", start_ms=0, duration_ms=30, attributes={"attempt": 1}),
        Span(
            name="compaction",
            status="ok",
            start_ms=0,
            duration_ms=31,
            attributes={"folded_exchanges": 2, "kept_exchanges": 2},
        ),
    ]
    named = by_name(build(record(spans, operation="compact", language=None)))
    assert "chat.compact" in named
    compaction = attributes(named["compaction"])
    assert compaction["langfuse.observation.type"] == "chain"
    assert compaction["langfuse.observation.metadata.folded_exchanges"] == "2"
    assert named["model.main"]["parentSpanId"] == named["compaction"]["spanId"]


# --- Filtering by construction -------------------------------------------------------------------


SEEDED = {
    "authorization": "Bearer sk-ant-api03-FAKEfakeFAKEfakeFAKE00",
    "cookie": "session=fictional",
    "client_ip": "203.0.113.42",
    "user_agent": "FictionalBrowser/1.0",
    "reasoning": "the visitor seems to be Daniel Okafor",
    "question": EN,
    "raw": "{dump}",
    "category": "contact tomas.herrera@northwind.example.com or +44 20 7946 0958",
}


def test_only_allowlisted_attributes_leave_and_their_strings_are_masked() -> None:
    spans = [Span(name="stage.security", status="ok", start_ms=0, duration_ms=5, attributes=SEEDED)]
    payload = build(record(spans))
    text = json.dumps(payload)
    for value in (
        "sk-ant-api03",
        "session=fictional",
        "203.0.113.42",
        "FictionalBrowser",
        "Daniel Okafor",
        "Ilsa Marrow",
        "{dump}",
        "tomas.herrera",
        "7946 0958",
    ):
        assert value not in text
    security = attributes(by_name(payload)["stage.security"])
    assert "[EMAIL:" in security["langfuse.observation.metadata.category"]
    keys = {key.rsplit(".", 1)[-1] for key in security}
    for denied in ("authorization", "cookie", "client_ip", "user_agent", "reasoning", "question"):
        assert denied not in keys


def test_span_names_and_statuses_outside_the_fixed_vocabulary_are_replaced() -> None:
    spans = [
        Span(name="tool.mail tomas.herrera@northwind.example.com", status="ok", duration_ms=1),
        Span(name="stage.main", status="Daniel Okafor said", duration_ms=1),
    ]
    payload = build(record(spans))
    text = json.dumps(payload)
    assert "tomas.herrera" not in text
    assert "Daniel Okafor" not in text
    names = [span["name"] for span in exported_spans(payload)]
    assert "tool.unnamed" in names


async def test_the_payload_has_no_events_links_content_or_host_resource() -> None:
    payload = build(await answered())
    (resource,) = payload["resourceSpans"]
    keys = {attribute["key"] for attribute in resource["resource"]["attributes"]}
    assert keys == {"service.name"}
    for span in exported_spans(payload):
        assert "events" not in span
        assert "links" not in span
        for key in attributes(span):
            assert not key.endswith((".input", ".output"))
            assert not key.startswith(("gen_ai.prompt", "gen_ai.completion", "http.", "net."))


async def test_the_payload_records_the_metadata_only_mode_and_why() -> None:
    root = attributes(by_name(build(await answered(), degraded="no_detector"))["chat.answer"])
    assert root["langfuse.trace.metadata.export_mode"] == "metadata"
    assert root["langfuse.trace.metadata.degraded"] == "no_detector"
    plain = attributes(by_name(build(await answered()))["chat.answer"])
    assert plain["langfuse.trace.metadata.export_mode"] == "metadata"
    assert "langfuse.trace.metadata.degraded" not in plain


@pytest.mark.parametrize("trace_id", ["", "0" * 32, "ABCDEF" + "0" * 26, "abc", "g" * 32])
def test_the_trace_id_must_be_a_valid_w3c_identifier(trace_id: str) -> None:
    with pytest.raises(ValueError, match="trace"):
        build(record([]), trace_id=trace_id)


def test_the_execution_identifier_is_not_exported() -> None:
    text = json.dumps(build(record([], execution_id="9e2b1c7a-operation")))
    assert "9e2b1c7a-operation" not in text
