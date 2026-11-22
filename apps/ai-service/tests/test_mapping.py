"""The agent result becomes the API's result body: contract blocks and sources, nothing hidden."""

from __future__ import annotations

import datetime
from typing import Any, get_args

import pytest
from llm_agent import (
    ChatResult,
    ContactCard,
    ContactLink,
    Evidence,
    ExperienceCard,
    RoadmapCard,
    ServiceCard,
    Source,
    Span,
    Usage,
    versions,
)
from llm_agent.schemas.responses import Outcome, SourceKind

from ai_service.runtime.mapping import history_for, report_for
from ai_service.schemas import GenerationRequest
from tests.fakes import FakeApi

KEYS = {
    "grant",
    "outcome",
    "reason",
    "language",
    "text",
    "blocks",
    "sources",
    "related",
    "usage",
    "versions",
    "latencyMs",
}


def source(kind: SourceKind, record_id: str, ref: str = "src-1") -> Source:
    return Source(ref=ref, kind=kind, record_id=record_id, title=f"Title {record_id}", href="/")


def result(outcome: Outcome = "answered", **fields: Any) -> ChatResult:
    values: dict[str, Any] = {
        "outcome": outcome,
        "reason": None if outcome == "answered" else "some_reason",
        "language": "en",
        "text": "Ilsa Marrow is a fictional engineer.",
        "contact": None,
        "sources": [],
        "blocks": [],
        "evidence": [
            Evidence(
                ref="src-1",
                tool="get_profile",
                kind="profile",
                record_id="p1",
                title="Ilsa Marrow",
                href="/",
                data={"draft": "HIDDEN-EVIDENCE-DATA"},
            )
        ],
        "usage": Usage(
            model_attempts=3,
            retries=1,
            input_tokens=3000,
            output_tokens=600,
            cache_read_tokens=10,
            cost_usd=0.0006,
        ),
        "trace": [Span(name="stage.main", status="ok", duration_ms=5, attributes={"x": "TRACE"})],
        "versions": versions(),
        "execution_id": "exec",
        "trace_id": "trace",
    }
    values.update(fields)
    return ChatResult(**values)


def body(value: ChatResult, **options: Any) -> dict[str, Any]:
    report = report_for(value, grant="grant-1", latency_ms=1234, **options)
    dumped: dict[str, Any] = report.model_dump(mode="json", by_alias=True)
    return dumped


@pytest.mark.parametrize("outcome", get_args(Outcome))
def test_every_outcome_is_reported_as_is(outcome: Outcome) -> None:
    payload = body(result(outcome))
    assert set(payload) == KEYS
    assert payload["outcome"] == outcome
    assert payload["grant"] == "grant-1"
    assert payload["latencyMs"] == 1234
    assert payload["related"] == []


def test_the_usage_and_versions_are_reported() -> None:
    payload = body(result())
    assert payload["usage"] == {
        "costUsd": 0.0006,
        "costUncertain": False,
        "inputTokens": 3000,
        "outputTokens": 600,
        "modelAttempts": 3,
    }
    assert payload["versions"]["mainModel"] == versions().main_model
    assert payload["versions"]["pricing"] == versions().pricing
    assert payload["versions"]["runtime"] == versions().runtime


def test_no_evidence_data_trace_or_draft_leaves_the_service() -> None:
    text = str(body(result()))
    assert "HIDDEN-EVIDENCE-DATA" not in text
    assert "TRACE" not in text
    assert "exec" not in body(result())["versions"].values()


def test_an_interrupted_operation_is_cancelled_with_uncertain_usage() -> None:
    payload = body(result("cancelled"), interrupted=True)
    assert payload["outcome"] == "cancelled"
    assert payload["reason"] == "interrupted"
    assert payload["usage"]["costUncertain"] is True


@pytest.mark.parametrize(
    ("kind", "expected"),
    [
        ("profile", "person"),
        ("contact", "person"),
        ("experience", "experience"),
        ("project", "project"),
        ("exploration", "exploration"),
        ("service", "service"),
        ("roadmap", "roadmap_item"),
        ("roadmap_area", "roadmap_item"),
        ("roadmap_module", "roadmap_item"),
        ("education", "person"),
        ("current_focus", "person"),
        ("diary_day", "person"),
        ("statistics", "person"),
        ("book", "person"),
        ("event", "person"),
    ],
)
def test_source_kinds_become_contract_kinds(kind: SourceKind, expected: str) -> None:
    payload = body(result(sources=[source(kind, "r1")]))
    assert payload["sources"] == [
        {"record": {"kind": expected, "id": "r1"}, "title": "Title r1", "href": "/"}
    ]


def test_sources_are_deduplicated_and_capped_at_eight() -> None:
    many = [source("project", f"p{index}", ref=f"src-{index}") for index in range(10)]
    payload = body(result(sources=[source("profile", "a"), source("contact", "a"), *many]))
    records = [item["record"] for item in payload["sources"]]
    assert records[0] == {"kind": "person", "id": "a"}
    assert len(records) == 8
    assert len({(record["kind"], record["id"]) for record in records}) == 8


def test_blocks_keep_the_contract_camel_case_shape() -> None:
    blocks = [
        ExperienceCard(
            title="Engineer",
            organization="Fictional Co",
            started_on=datetime.date(2020, 1, 1),
            ended_on=None,
            summary=None,
            technologies=["Python"],
            href="/experience#experience-x",
        ),
        ServiceCard(title="Reviews", summary="Fictional reviews.", href="/services#s"),
        RoadmapCard(title="Evals", summary=None, href="/roadmap#evals"),
    ]
    payload = body(result(blocks=blocks))
    assert payload["blocks"][0] == {
        "type": "ExperienceCard",
        "title": "Engineer",
        "organization": "Fictional Co",
        "startedOn": "2020-01-01",
        "endedOn": None,
        "summary": None,
        "technologies": ["Python"],
        "href": "/experience#experience-x",
    }
    assert [block["type"] for block in payload["blocks"]] == [
        "ExperienceCard",
        "ServiceCard",
        "RoadmapCard",
    ]


def test_the_contact_card_becomes_a_contact_block_without_a_name() -> None:
    links = [
        ContactLink(label=f"Link {index}", url=f"https://l{index}.example.test/")
        for index in range(8)
    ]
    contact = ContactCard(
        name="Ilsa Marrow",
        email="ilsa@marrow.example.test",
        links=[ContactLink(label="Bad", url="javascript:alert(1)"), *links],
    )
    payload = body(result(contact=contact))
    block = payload["blocks"][-1]
    assert block["type"] == "ContactCard"
    assert "name" not in block
    assert block["email"] == "ilsa@marrow.example.test"
    assert len(block["links"]) == 6
    assert all(link["url"].startswith("https://") for link in block["links"])


def test_history_sources_map_back_to_agent_kinds() -> None:
    request = GenerationRequest.model_validate(
        {
            **FakeApi().issue(),
            "history": [
                {
                    "question": "Who?",
                    "answer": "Ilsa.",
                    "language": "en",
                    "sources": [
                        {"kind": "person", "recordId": "a", "title": "Ilsa"},
                        {"kind": "technology_group", "recordId": "b", "title": "Python"},
                        {"kind": "roadmap_item", "recordId": "c", "title": "Evals"},
                        {"kind": "project", "recordId": "d", "title": "Project"},
                    ],
                }
            ],
        }
    )
    history = history_for(request.history)
    assert [item.kind for item in history[0].sources] == [
        "profile",
        "profile",
        "roadmap",
        "project",
    ]
    assert history[0].question == "Who?"
    assert history[0].answer == "Ilsa."
