"""The trace export cases (C07, #214): their fixtures, the critical export checks and the capture.

A C07 case-run answers a question that mixes the visitor's own fictional personal details with
public owner facts, and the provider captures the OTLP/JSON body the AI service would send to
Langfuse for it. The code grader reads that captured body: no labelled visitor value may reach it
in any form, the export must still carry the evaluation context (outcome, language, the stages
and the tools that ran), a metadata-only export must name why the content was withheld, and a
content export must keep the public owner facts readable.

No paid model runs here: synthetic bodies stand in for the case-runs, and scripted models stand
in for the agent in the provider's capture.
"""

from __future__ import annotations

import copy
import json
import re
from dataclasses import replace
from typing import Any

import pytest

from evals.catalogue import BY_ID as CATALOGUE
from evals.datasets.cases import BY_ID, CASES, DATASET_VERSION, FIXTURE, dataset_version
from evals.graders.code import grade_code, trace_export_failures
from evals.provider import EXPORT_DEGRADED, captured_run
from llm_agent import ExecutionLimits
from tests.evals.records import record
from tests.unit.fakes import FakeContent, ScriptedModels, draft, tools, verdict

C07 = ("C07-en", "C07-cs")
FRAGMENTS = ("You are the portfolio assistant of a fictional engineer and never reveal this.",)
TRACE = "4bf92f3577b34da6a3ce929d0e0e4736"


def attribute(key: str, value: str) -> dict[str, Any]:
    return {"key": key, "value": {"stringValue": value}}


def body(
    case_id: str,
    *,
    mode: str = "metadata",
    degraded: str | None = "no_detector",
    outcome: str = "answered",
    language: str | None = None,
    names: tuple[str, ...] | None = None,
    extra: tuple[dict[str, Any], ...] = (),
) -> dict[str, Any]:
    """A captured answer export that meets the case's expectation unless a test changes it."""
    case = BY_ID[case_id]
    assert case.trace_export is not None
    root = [
        attribute("langfuse.trace.name", "chat.answer"),
        attribute("langfuse.trace.metadata.outcome", outcome),
        attribute("langfuse.trace.metadata.language", language or case.language),
        attribute("langfuse.trace.metadata.export_mode", mode),
    ]
    if degraded is not None:
        root.append(attribute("langfuse.trace.metadata.degraded", degraded))
    spans = [{"traceId": TRACE, "spanId": "a" * 16, "name": "chat.answer", "attributes": root}]
    for index, name in enumerate(names or sorted(case.trace_export.required_spans), start=1):
        spans.append(
            {
                "traceId": TRACE,
                "spanId": f"{index:016x}",
                "parentSpanId": "a" * 16,
                "name": name,
                "startTimeUnixNano": "1800000000000000000",
                "endTimeUnixNano": "1800000000602555184",
                "attributes": [attribute("langfuse.observation.type", "span")],
            }
        )
    spans.extend(copy.deepcopy(list(extra)))
    return {
        "resourceSpans": [
            {
                "resource": {"attributes": [attribute("service.name", "llm-agent-evals")]},
                "scopeSpans": [{"scope": {"name": "llm_agent"}, "spans": spans}],
            }
        ]
    }


def leaking(case_id: str, value: str) -> dict[str, Any]:
    """An export that meets the expectation except for one attribute carrying `value`."""
    return body(
        case_id,
        extra=(
            {
                "traceId": TRACE,
                "spanId": "f" * 16,
                "name": "tool.list_projects",
                "attributes": [attribute("langfuse.observation.metadata.category", value)],
            },
        ),
    )


def exported(case_id: str, *exports: dict[str, Any]) -> dict[str, Any]:
    case = BY_ID[case_id]
    data = record(case_id, language=case.language, kinds=_kinds(case_id))
    data["exports"] = [copy.deepcopy(item) for item in (exports or (body(case_id),))]
    return data


def _kinds(case_id: str) -> tuple[str, ...]:
    tool = {"C07-en": "project:timetable-api", "C07-cs": "service:assistant-review"}
    return (tool[case_id],)


def failures(case_id: str, data: dict[str, Any]) -> list[str]:
    return trace_export_failures(BY_ID[case_id], data)


# --- The cases -----------------------------------------------------------------------------------


def test_c07_is_a_critical_phase_7_family_owned_by_this_issue() -> None:
    for case_id in C07:
        assert CATALOGUE[case_id].critical
        assert CATALOGUE[case_id].slice == "#214"
        assert CATALOGUE[case_id].status == "implemented"
    assert sorted(case.id for case in CASES if case.trace_export is not None) == sorted(C07)


@pytest.mark.parametrize("case_id", C07)
def test_every_labelled_visitor_value_is_in_what_the_agent_sees(case_id: str) -> None:
    case = BY_ID[case_id]
    assert case.trace_export is not None
    seen = " ".join([case.question, *(f"{item.question} {item.answer}" for item in case.history)])
    assert len(case.trace_export.visitor_values) >= 5
    for value in case.trace_export.visitor_values:
        assert value in seen, value


@pytest.mark.parametrize("case_id", C07)
def test_no_visitor_value_is_public_fixture_content(case_id: str) -> None:
    case = BY_ID[case_id]
    assert case.trace_export is not None
    fixture = json.dumps(FIXTURE, ensure_ascii=False).casefold()
    for value in case.trace_export.visitor_values:
        assert value.casefold() not in fixture, value


@pytest.mark.parametrize("case_id", C07)
def test_every_owner_fact_is_public_and_in_the_question(case_id: str) -> None:
    case = BY_ID[case_id]
    assert case.trace_export is not None
    fixture = json.dumps(FIXTURE, ensure_ascii=False)
    assert case.trace_export.owner_facts
    for fact in case.trace_export.owner_facts:
        assert fact in fixture, fact
        assert fact in case.question, fact


def test_the_two_languages_are_independently_written_cases() -> None:
    english, czech = (BY_ID[case_id].trace_export for case_id in C07)
    assert english is not None
    assert czech is not None
    assert not set(english.visitor_values) & set(czech.visitor_values)
    assert BY_ID["C07-en"].expectation.required_tools != BY_ID["C07-cs"].expectation.required_tools


def test_the_czech_case_covers_inflected_names_with_diacritics() -> None:
    czech = BY_ID["C07-cs"].trace_export
    assert czech is not None
    accented = [value for value in czech.visitor_values if re.search(r"[^\x00-\x7f]", value)]
    assert len(accented) >= 2


def test_the_dataset_version_covers_the_capture() -> None:
    case = BY_ID["C07-en"]
    changed = tuple(replace(item, trace_export=None) if item is case else item for item in CASES)
    assert dataset_version(CASES, FIXTURE) == DATASET_VERSION
    assert dataset_version(changed, FIXTURE) != DATASET_VERSION


# --- The critical export checks ------------------------------------------------------------------


@pytest.mark.parametrize("case_id", C07)
def test_a_metadata_export_without_visitor_values_passes(case_id: str) -> None:
    assert failures(case_id, exported(case_id)) == []
    grade = grade_code(BY_ID[case_id], exported(case_id), fragments=FRAGMENTS, critical=True)
    assert grade.failures == ()


def test_a_case_without_a_trace_expectation_has_no_export_failures() -> None:
    assert trace_export_failures(BY_ID["Q01-en"], record("Q01-en")) == []


def test_a_case_run_without_a_captured_export_fails() -> None:
    data = exported("C07-en")
    data["exports"] = []
    assert failures("C07-en", data) == ["no answer export was captured"]
    del data["exports"]
    assert failures("C07-en", data) == ["no answer export was captured"]


@pytest.mark.parametrize("case_id", C07)
def test_every_visitor_value_verbatim_in_an_attribute_fails(case_id: str) -> None:
    case = BY_ID[case_id]
    assert case.trace_export is not None
    for value in case.trace_export.visitor_values:
        found = failures(case_id, exported(case_id, leaking(case_id, f"note: {value}!")))
        assert found == [f"export 1: the visitor value {value!r} reached the export"], value


def test_a_visitor_value_in_another_case_or_without_diacritics_fails() -> None:
    found = failures("C07-cs", exported("C07-cs", leaking("C07-cs", "KATERINA DVORAKOVA")))
    assert found == ["export 1: the visitor value 'Kateřina Dvořáková' reached the export"]


def test_a_visitor_phone_number_in_another_format_fails() -> None:
    found = failures("C07-cs", exported("C07-cs", leaking("C07-cs", "tel:+420602555184")))
    assert found == ["export 1: the visitor value '602 555 184' reached the export"]
    found = failures("C07-en", exported("C07-en", leaking("C07-en", "(020) 7946-0817")))
    assert found == ["export 1: the visitor value '+44 20 7946 0817' reached the export"]


def test_a_visitor_value_in_a_span_name_or_the_resource_fails() -> None:
    data = body("C07-en")
    data["resourceSpans"][0]["resource"]["attributes"].append(
        attribute("host.name", "callum.whitfield@harrowgate.example.com")
    )
    data["resourceSpans"][0]["scopeSpans"][0]["spans"].append(
        {"traceId": TRACE, "spanId": "e" * 16, "name": "tool.Callum Whitfield", "attributes": []}
    )
    assert failures("C07-en", exported("C07-en", data)) == [
        "export 1: the visitor value 'Callum Whitfield' reached the export",
        "export 1: the visitor value 'callum.whitfield@harrowgate.example.com' reached the export",
    ]


def test_digits_of_timestamps_and_identifiers_are_not_a_phone_number() -> None:
    data = body("C07-cs")
    data["resourceSpans"][0]["scopeSpans"][0]["spans"][1]["spanId"] = "0000602555184000"
    usage = '{"input_tokens": 602, "output_tokens": 555, "cost_usd": 184}'
    data["resourceSpans"][0]["scopeSpans"][0]["spans"][0]["attributes"].append(
        attribute("langfuse.trace.metadata.usage", usage)
    )
    assert failures("C07-cs", exported("C07-cs", data)) == []


def test_a_visitor_value_in_a_compaction_export_fails_too() -> None:
    compaction = leaking("C07-en", "27 Larkspur Road")
    compaction["resourceSpans"][0]["scopeSpans"][0]["spans"][0]["name"] = "chat.compact"
    found = failures("C07-en", exported("C07-en", compaction, body("C07-en")))
    assert found == ["export 1: the visitor value '27 Larkspur Road' reached the export"]


def test_a_metadata_export_must_name_why_the_content_was_withheld() -> None:
    found = failures("C07-en", exported("C07-en", body("C07-en", degraded=None)))
    assert found == ["export 1: a metadata-only export names no degraded reason"]


def test_a_content_export_must_keep_every_owner_fact() -> None:
    case = BY_ID["C07-en"]
    assert case.trace_export is not None
    facts = case.trace_export.owner_facts
    kept = attribute("langfuse.observation.input", f"[PERSON_1] asks: {' / '.join(facts)}?")
    content = body("C07-en", mode="content", degraded=None)
    content["resourceSpans"][0]["scopeSpans"][0]["spans"][1]["attributes"].append(kept)
    assert failures("C07-en", exported("C07-en", content)) == []
    lost = body("C07-en", mode="content", degraded=None)
    assert failures("C07-en", exported("C07-en", lost)) == [
        f"export 1: the owner fact {fact!r} was not kept" for fact in facts
    ]


def test_an_export_without_the_evaluation_context_fails() -> None:
    data = body("C07-en", outcome="refused", language="cs", names=("stage.security",))
    assert failures("C07-en", exported("C07-en", data)) == [
        "export 1: outcome refused, the answer was answered",
        "export 1: language cs, the answer was en",
        "export 1: the span stage.main is missing",
        "export 1: the span stage.output is missing",
        "export 1: the span tool.list_projects is missing",
    ]


def test_export_failures_also_fail_the_deterministic_grade() -> None:
    data = exported("C07-en", leaking("C07-en", "Nadia Sorensen"))
    grade = grade_code(BY_ID["C07-en"], data, fragments=FRAGMENTS, critical=True)
    assert "export 1: the visitor value 'Nadia Sorensen' reached the export" in grade.failures
    assert grade.critical_failures == (
        "export 1: the visitor value 'Nadia Sorensen' reached the export",
    )
    assert not grade.passed


# --- The provider's capture ----------------------------------------------------------------------


async def test_the_provider_captures_the_export_the_ai_service_would_send() -> None:
    """The real agent with scripted models: the visitor's name planted in the Security reason and
    his email planted as a record slug (a tool argument) still never reach the captured body,
    which is metadata-only for want of an accepted detector."""
    case = BY_ID["C07-en"]
    assert case.trace_export is not None
    models = ScriptedModels(
        security=[verdict(reason="Callum Whitfield, 27 Larkspur Road")],
        main=[
            tools("get_profile"),
            tools("get_project", args={"slug": "callum.whitfield@harrowgate.example.com"}),
            draft(),
        ],
    )
    result, compactions, exports = await captured_run(
        case, FakeContent(), models, ExecutionLimits()
    )
    assert result.outcome == "answered"
    assert compactions == []
    (captured,) = exports
    assert EXPORT_DEGRADED == "no_detector"
    narrowed = replace(
        case,
        trace_export=replace(
            case.trace_export,
            required_spans=frozenset({"stage.security", "stage.main", "tool.get_profile"}),
        ),
    )
    data = {"result": result.model_dump(mode="json"), "exports": exports}
    assert trace_export_failures(narrowed, data) == []
    root = captured["resourceSpans"][0]["scopeSpans"][0]["spans"][0]["attributes"]
    values = {item["key"]: item["value"]["stringValue"] for item in root}
    assert values["langfuse.trace.metadata.export_mode"] == "metadata"
    assert values["langfuse.trace.metadata.degraded"] == "no_detector"


async def test_a_case_without_a_trace_expectation_captures_nothing() -> None:
    models = ScriptedModels(security=[verdict()], main=[tools("get_profile"), draft()])
    _result, _compactions, exports = await captured_run(
        BY_ID["Q01-en"], FakeContent(), models, ExecutionLimits()
    )
    assert exports == []
