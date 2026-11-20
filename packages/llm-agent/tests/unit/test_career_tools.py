"""The career read tools through the chat operation: projections, sources, blocks and bounds."""

from __future__ import annotations

import json
from typing import Any

import pytest

from llm_agent import ChatAgent, ChatRequest, ChatResult, ExecutionLimits
from tests.unit.fakes import (
    EDUCATION,
    EXPERIENCES,
    EXPLORATIONS,
    PROJECTS,
    SERVICES,
    FakeContent,
    ScriptedModels,
    calls,
    draft,
    spans,
    tools,
    verdict,
)

QUESTION = "What has Ilsa Marrow built in retrieval and evaluation?"


async def run(
    main: list[Any],
    *,
    content: FakeContent | None = None,
    limits: ExecutionLimits | None = None,
) -> tuple[ChatResult, ScriptedModels]:
    models = ScriptedModels(security=[verdict()], main=main)
    agent = ChatAgent(content=content or FakeContent(), models=models)
    result = await agent.run(ChatRequest(question=QUESTION), limits=limits)
    return result, models


def tool_results(models: ScriptedModels, decision: int = 1) -> list[dict[str, Any]]:
    """The tool results the model saw before its next decision, in call order."""
    messages = models.stage_calls("main")[decision][1]
    return [json.loads(str(m.content)) for m in messages if m.type == "tool"]


def sources(result: ChatResult) -> list[tuple[str, str, str, str]]:
    return [(s.kind, s.record_id, s.title, s.href) for s in result.sources]


def blocks(result: ChatResult) -> list[dict[str, Any]]:
    return [block.model_dump(mode="json") for block in result.blocks]


# --- The model sees only the allowlisted read tools -----------------------------------------------


async def test_the_main_stage_offers_exactly_the_public_read_tools() -> None:
    _, models = await run([draft(refs=())])
    offered = {tool["name"]: tool for tool in models.stage_calls("main")[0][0].tools}
    assert sorted(offered) == [
        "get_contact",
        "get_profile",
        "get_project",
        "list_education",
        "list_experiences",
        "list_explorations",
        "list_projects",
        "list_services",
    ]
    slug = offered["get_project"]["input_schema"]
    assert slug["required"] == ["slug"]
    assert slug["additionalProperties"] is False
    assert slug["properties"]["slug"]["maxLength"] == 100
    for name, spec in offered.items():
        if name != "get_project":
            assert spec["input_schema"]["properties"] == {}, name


# --- Experiences ----------------------------------------------------------------------------------


async def test_an_experience_answer_cites_the_record_and_returns_its_card() -> None:
    result, models = await run(
        [tools("list_experiences"), draft("Ilsa is an AI engineer at Brindle Labs.")]
    )
    assert result.outcome == "answered"
    assert sources(result) == [
        (
            "experience",
            "brindle-labs-ai-engineer",
            "AI engineer, Brindle Labs",
            "/experience#experience-brindle-labs-ai-engineer",
        )
    ]
    seen = tool_results(models)[0]
    assert seen["ok"] is True
    [record] = seen["records"]
    assert record["ref"] == "src-1"
    assert record["kind"] == "experience"
    assert record["data"]["organization"] == "Brindle Labs"
    assert record["data"]["started_on"] == "2021-03-01"
    assert record["data"]["ended_on"] is None
    assert [p["slug"] for p in record["data"]["projects"]] == [
        "support-answer-engine",
        "evaluation-harness",
    ]
    assert blocks(result) == [
        {
            "type": "ExperienceCard",
            "title": "AI engineer",
            "organization": "Brindle Labs",
            "started_on": "2021-03-01",
            "ended_on": None,
            "summary": "Builds fictional evaluated assistants.",
            "technologies": ["Python", "LangGraph", "pgvector", "PostgreSQL"],
            "href": "/experience#experience-brindle-labs-ai-engineer",
        }
    ]


async def test_blocks_serialize_with_the_contract_field_names() -> None:
    result, _ = await run([tools("list_experiences"), draft("Ilsa is an AI engineer.")])
    payload = result.blocks[0].model_dump(mode="json", by_alias=True)
    assert payload["startedOn"] == "2021-03-01"
    assert "endedOn" in payload


# --- Projects -------------------------------------------------------------------------------------


async def test_a_project_keeps_its_experience_and_dates_and_its_own_source() -> None:
    result, models = await run(
        [tools("list_projects"), draft("Ilsa built the support answer engine.", refs=("src-1",))]
    )
    records = tool_results(models)[0]["records"]
    assert [r["data"]["slug"] for r in records] == ["support-answer-engine", "evaluation-harness"]
    first = records[0]["data"]
    assert first["experience"] == "brindle-labs-ai-engineer"
    assert (first["started_on"], first["ended_on"]) == ("2021-06-01", "2023-04-30")
    assert first["has_case_study"] is True
    assert "case_study" not in first
    assert sources(result) == [
        (
            "project",
            "support-answer-engine",
            "Support answer engine",
            "/experience#project-support-answer-engine",
        )
    ]
    assert result.blocks == []


async def test_get_project_adds_the_case_study_to_the_same_source() -> None:
    content = FakeContent()
    result, models = await run(
        [
            tools("list_projects"),
            tools("get_project", args={"slug": "support-answer-engine"}),
            draft("Ilsa led the support answer engine.", refs=("src-1",)),
        ],
        content=content,
    )
    [detail] = tool_results(models, 2)[1:]
    assert detail["ok"] is True
    [record] = detail["records"]
    assert record["ref"] == "src-1"
    assert record["data"]["case_study"] == {
        "role": "Lead engineer",
        "body": "A fictional case study.",
    }
    assert [e.ref for e in result.evidence] == ["src-1", "src-2"]
    assert result.evidence[0].data["case_study"]["role"] == "Lead engineer"
    assert content.calls == ["read_projects", "read_project:support-answer-engine"]


async def test_a_missing_project_is_not_found_and_records_no_evidence() -> None:
    result, models = await run(
        [
            tools("get_project", args={"slug": "orbital-launcher"}),
            draft("There is no such project.", outcome="insufficient_evidence", refs=()),
        ]
    )
    assert tool_results(models)[0]["error"] == "not_found"
    assert ("tool.get_project", "not_found") in spans(result)
    assert [item.kind for item in result.evidence] == ["contact"]


@pytest.mark.parametrize(
    "args",
    [
        {},
        {"slug": "../admin"},
        {"slug": "Support Answer Engine"},
        {"slug": "a" * 101},
        {"slug": 7},
        {"slug": "support-answer-engine", "url": "https://evil.example.test"},
    ],
)
async def test_get_project_arguments_are_validated_before_any_read(args: dict[str, Any]) -> None:
    content = FakeContent()
    result, models = await run(
        [tools("get_project", args=args), draft(outcome="refused", refs=())], content=content
    )
    assert content.reads == 0
    assert ("tool.get_project", "invalid_arguments") in spans(result)
    assert tool_results(models)[0]["error"] == "invalid_arguments"


@pytest.mark.parametrize(
    "name",
    ["list_experiences", "list_projects", "list_services", "list_explorations", "list_education"],
)
async def test_the_list_tools_take_no_arguments(name: str) -> None:
    content = FakeContent()
    result, _ = await run(
        [tools(name, args={"sql": "select 1"}), draft(outcome="refused", refs=())], content=content
    )
    assert content.reads == 0
    assert (f"tool.{name}", "invalid_arguments") in spans(result)


# --- Services, explorations, education ------------------------------------------------------------


async def test_a_service_carries_its_evidence_identities_and_returns_its_card() -> None:
    result, models = await run([tools("list_services"), draft("Ilsa offers an evaluation setup.")])
    [record] = tool_results(models)[0]["records"]
    assert record["data"]["evidence"] == [
        {
            "kind": "project",
            "slug": "evaluation-harness",
            "name": "Evaluation harness",
            "summary": "A fictional harness.",
            "status": None,
        },
        {
            "kind": "exploration",
            "slug": "reranking-trial",
            "name": "Reranking trial",
            "summary": "A fictional trial.",
            "status": "tested",
        },
    ]
    assert sources(result) == [
        ("service", "evaluation-setup", "Evaluation setup", "/services#service-evaluation-setup")
    ]
    assert blocks(result) == [
        {
            "type": "ServiceCard",
            "title": "Evaluation setup",
            "summary": "A fictional evaluation setup for chat assistants.",
            "href": "/services#service-evaluation-setup",
        }
    ]


async def test_exploration_cards_keep_the_stored_status() -> None:
    result, _ = await run(
        [
            tools("list_explorations"),
            draft(
                "A reranking trial was tested; a memory design is not implemented.",
                refs=("src-1", "src-2"),
            ),
        ]
    )
    assert [(b["title"], b["status"]) for b in blocks(result)] == [
        ("Reranking trial", "tested"),
        ("Conversation memory design", "designed"),
    ]
    assert [b["href"] for b in blocks(result)] == [
        "/experience#exploration-reranking-trial",
        "/experience#exploration-conversation-memory-design",
    ]
    assert result.evidence[1].data["status"] == "designed"


async def test_education_is_cited_on_the_education_section_without_a_block() -> None:
    result, models = await run(
        [tools("list_education"), draft("Ilsa took a course on retrieval evaluation.")]
    )
    [record] = tool_results(models)[0]["records"]
    assert record["data"]["kind"] == "course"
    assert record["data"]["started_on"] is None
    assert sources(result) == [
        (
            "education",
            "retrieval-evaluation-course",
            "Retrieval evaluation",
            "/experience#education-heading",
        )
    ]
    assert result.blocks == []


async def test_no_tool_result_carries_a_url_from_the_records() -> None:
    _, models = await run(
        [
            calls(
                ("list_experiences", {}),
                ("list_projects", {}),
                ("list_services", {}),
                ("list_explorations", {}),
                ("list_education", {}),
            ),
            draft(refs=()),
        ]
    )
    seen = json.dumps(tool_results(models))
    assert "http" not in seen
    assert "example.test" not in seen


# --- Blocks follow only the approved, cited sources -----------------------------------------------


async def test_only_cited_records_get_blocks_and_at_most_three() -> None:
    many = [
        EXPLORATIONS[0].model_copy(update={"slug": f"trial-{n}", "name": f"Trial {n}"})
        for n in range(5)
    ]
    result, _ = await run(
        [
            tools("list_explorations"),
            draft("Five trials were tested.", refs=("src-5", "src-1", "src-2", "src-3")),
        ],
        content=FakeContent(explorations=many),
    )
    assert [b["title"] for b in blocks(result)] == ["Trial 4", "Trial 0", "Trial 1"]


async def test_a_replaced_answer_has_no_blocks() -> None:
    result, _ = await run(
        [tools("list_experiences"), draft("See https://evil.example.test/cv for more.")]
    )
    assert result.outcome == "insufficient_evidence"
    assert result.blocks == []


async def test_an_insufficient_answer_has_no_blocks() -> None:
    result, _ = await run(
        [
            tools("list_experiences"),
            draft("No certification is listed.", outcome="insufficient_evidence"),
        ]
    )
    assert result.outcome == "insufficient_evidence"
    assert result.blocks == []
    assert result.contact is not None


async def test_a_refusal_has_no_blocks() -> None:
    result, _ = await run([tools("list_experiences"), draft(outcome="refused", refs=())])
    assert result.outcome == "refused"
    assert result.blocks == []


# --- Bounds: size, total context, malformed results -----------------------------------------------


async def test_a_list_with_more_records_than_allowed_is_rejected_not_truncated() -> None:
    many = [
        EDUCATION[0].model_copy(update={"slug": f"course-{n}", "title": f"Course {n}"})
        for n in range(31)
    ]
    result, models = await run(
        [tools("list_education"), draft(outcome="refused", refs=())],
        content=FakeContent(education=many),
    )
    assert ("tool.list_education", "too_large") in spans(result)
    assert tool_results(models)[0]["error"] == "too_large"
    assert result.evidence == []


async def test_an_oversized_list_result_is_rejected_not_truncated() -> None:
    huge = [EXPERIENCES[0].model_copy(update={"summary": "word " * 10_000})]
    result, models = await run(
        [tools("list_experiences"), draft(outcome="refused", refs=())],
        content=FakeContent(experiences=huge),
    )
    assert ("tool.list_experiences", "too_large") in spans(result)
    assert "word word" not in json.dumps(tool_results(models))
    assert result.evidence == []


async def test_results_beyond_the_total_context_allowance_are_withheld() -> None:
    big = "word " * 1_600  # 8000 bytes, so about 4000 tokens per list
    content = FakeContent(
        experiences=[EXPERIENCES[0].model_copy(update={"summary": big})],
        explorations=[EXPLORATIONS[0].model_copy(update={"summary": big})],
        services=[SERVICES[0].model_copy(update={"summary": big})],
    )
    result, models = await run(
        [
            calls(("list_experiences", {}), ("list_explorations", {}), ("list_services", {})),
            draft(refs=("src-1",)),
        ],
        content=content,
    )
    statuses = [status for name, status in spans(result) if name.startswith("tool.")]
    assert statuses == ["ok", "ok", "context_full"]
    assert [r.get("error") for r in tool_results(models)] == [None, None, "context_full"]
    assert [e.kind for e in result.evidence] == ["experience", "exploration"]
    assert result.blocks == []  # the oversized summary does not fit an experience card


async def test_duplicate_record_identities_make_the_read_unavailable() -> None:
    twice = [PROJECTS[0], PROJECTS[0]]
    result, _ = await run(
        [tools("list_projects"), draft(outcome="refused", refs=())],
        content=FakeContent(projects=twice),
    )
    assert ("tool.list_projects", "error") in spans(result)
    assert result.evidence == []


async def test_a_failed_career_read_is_unavailable_to_the_model() -> None:
    result, models = await run(
        [tools("list_services"), draft("No data.", outcome="insufficient_evidence", refs=())],
        content=FakeContent(fail=True),
    )
    assert ("tool.list_services", "error") in spans(result)
    assert tool_results(models)[0]["error"] == "unavailable"


# --- Reads: cached per execution, independent reads concurrent within the cap ---------------------


async def test_a_repeated_read_is_served_from_the_execution_cache() -> None:
    content = FakeContent()
    result, models = await run(
        [tools("list_projects"), tools("list_projects"), draft("Two projects.")],
        content=content,
    )
    assert content.calls == ["read_projects"]
    assert tool_results(models, 2)[1]["records"][0]["ref"] == "src-1"
    assert [e.ref for e in result.evidence] == ["src-1", "src-2"]


async def test_at_most_three_reads_run_at_once_and_evidence_keeps_the_call_order() -> None:
    content = FakeContent(
        delays={
            "read_experiences": 0.05,
            "read_projects": 0.01,
            "read_services": 0.02,
            "read_explorations": 0.0,
            "read_education": 0.0,
        }
    )
    result, models = await run(
        [
            calls(
                ("list_experiences", {}),
                ("list_projects", {}),
                ("list_services", {}),
                ("list_explorations", {}),
                ("list_education", {}),
                ("get_profile", {}),
            ),
            draft(refs=()),
        ],
        content=content,
    )
    assert content.peak == 3
    kinds = [record["records"][0]["kind"] for record in tool_results(models)[:5]]
    assert kinds == ["experience", "project", "service", "exploration", "education"]
    assert [e.kind for e in result.evidence][:2] == ["experience", "project"]
    assert result.evidence[0].ref == "src-1"
    names = [name for name, _ in spans(result) if name.startswith("tool.")]
    assert names[:6] == [
        "tool.list_experiences",
        "tool.list_projects",
        "tool.list_services",
        "tool.list_explorations",
        "tool.list_education",
        "tool.get_profile",
    ]


async def test_more_tool_requests_than_the_cap_stop_before_any_read() -> None:
    content = FakeContent()
    result, _ = await run([calls(*[("list_projects", {})] * 7), draft(refs=())], content=content)
    assert result.outcome == "limit_reached"
    assert result.reason == "tool_calls"
    assert content.reads == 0
