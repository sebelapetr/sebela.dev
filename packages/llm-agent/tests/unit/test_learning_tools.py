"""The learning read tools through the chat operation: projections, sources, blocks and bounds.

Times reach the model already formatted as the website shows them (`formatStudyTime`), so the
answer repeats the API's own aggregates instead of converting seconds; estimates are labelled.
"""

from __future__ import annotations

import datetime
import json
from typing import Any

import pytest

from llm_agent import ChatAgent, ChatRequest, ChatResult, ExecutionLimits
from llm_agent.tools.registry import study_time
from tests.unit.fakes import (
    AGENT_AREA,
    BOOKS,
    DIARY,
    EVENTS,
    ROADMAP,
    FakeContent,
    ScriptedModels,
    calls,
    draft,
    spans,
    tools,
    verdict,
)

QUESTION = "What is Ilsa learning on her AI Roadmap?"


async def run(
    main: list[Any],
    *,
    content: FakeContent | None = None,
    limits: ExecutionLimits | None = None,
    today: datetime.date | None = None,
) -> tuple[ChatResult, ScriptedModels]:
    models = ScriptedModels(security=[verdict()], main=main)
    agent = ChatAgent(content=content or FakeContent(), models=models)
    result = await agent.run(ChatRequest(question=QUESTION, today=today), limits=limits)
    return result, models


def tool_results(models: ScriptedModels, decision: int = 1) -> list[dict[str, Any]]:
    messages = models.stage_calls("main")[decision][1]
    return [json.loads(str(m.content)) for m in messages if m.type == "tool"]


def sources(result: ChatResult) -> list[tuple[str, str, str, str]]:
    return [(s.kind, s.record_id, s.title, s.href) for s in result.sources]


def blocks(result: ChatResult) -> list[dict[str, Any]]:
    return [block.model_dump(mode="json") for block in result.blocks]


# --- Formatting matches the website ---------------------------------------------------------------


@pytest.mark.parametrize(
    ("seconds", "shown"),
    [
        (0, "0 min"),
        (1, "<1 min"),
        (29, "<1 min"),
        (30, "1 min"),
        (89, "1 min"),
        (90, "2 min"),
        (3_569, "59 min"),
        (3_570, "1h"),
        (5_400, "1h 30m"),
        (19_800, "5h 30m"),
        (63_600, "17h 40m"),
    ],
)
def test_study_time_is_formatted_as_the_website_shows_it(seconds: int, shown: str) -> None:
    assert study_time(seconds) == shown


# --- The model sees the learning tools ------------------------------------------------------------


async def test_the_main_stage_offers_the_learning_read_tools() -> None:
    _, models = await run([draft(refs=())])
    offered = {tool["name"]: tool for tool in models.stage_calls("main")[0][0].tools}
    assert {
        "list_current_focus",
        "get_roadmap",
        "get_roadmap_area",
        "get_learning_diary",
        "get_learning_statistics",
        "list_books",
        "list_events",
    } <= set(offered)
    area = offered["get_roadmap_area"]["input_schema"]
    assert area["required"] == ["area"]
    assert area["additionalProperties"] is False
    assert area["properties"]["area"]["maxLength"] == 100


@pytest.mark.parametrize(
    "args",
    [{}, {"area": "../admin"}, {"area": "Agent Systems"}, {"area": 7}, {"slug": "agent-systems"}],
)
async def test_get_roadmap_area_arguments_are_validated_before_any_read(
    args: dict[str, Any],
) -> None:
    content = FakeContent()
    result, models = await run(
        [tools("get_roadmap_area", args=args), draft(outcome="refused", refs=())], content=content
    )
    assert content.reads == 0
    assert ("tool.get_roadmap_area", "invalid_arguments") in spans(result)
    assert tool_results(models)[0]["error"] == "invalid_arguments"


@pytest.mark.parametrize(
    "name",
    [
        "list_current_focus",
        "get_roadmap",
        "get_learning_diary",
        "get_learning_statistics",
        "list_books",
        "list_events",
    ],
)
async def test_the_other_learning_tools_take_no_arguments(name: str) -> None:
    content = FakeContent()
    result, _ = await run(
        [tools(name, args={"since": "2026-01-01"}), draft(outcome="refused", refs=())],
        content=content,
    )
    assert content.reads == 0
    assert (f"tool.{name}", "invalid_arguments") in spans(result)


# --- Current focus ----------------------------------------------------------------------------


async def test_a_current_focus_answer_cites_the_focus_section() -> None:
    result, models = await run(
        [tools("list_current_focus"), draft("Ilsa is learning agent guardrails.", refs=("src-2",))]
    )
    seen = tool_results(models)[0]
    assert seen["ok"] is True
    assert "kind" not in seen
    records = seen["records"]
    assert [r["kind"] for r in records] == ["current_focus", "current_focus"]
    assert records[0]["data"]["project"] == {
        "slug": "evaluation-harness",
        "name": "Evaluation harness",
        "experience": "brindle-labs-ai-engineer",
    }
    assert records[1]["data"]["topics"] == ["Agents"]
    assert sources(result) == [
        (
            "current_focus",
            "learning-agent-guardrails",
            "Learning how tool-using agents stay safe",
            "/#now-heading",
        )
    ]
    assert result.blocks == []


# --- Roadmap ------------------------------------------------------------------------------------


async def test_the_roadmap_keeps_the_stored_progress_and_labels_estimates() -> None:
    result, models = await run(
        [tools("get_roadmap"), draft("Agent systems is 1 of 4 done.", refs=("src-1", "src-2"))]
    )
    [summary, area] = tool_results(models)[0]["records"]
    assert summary["kind"] == "roadmap"
    assert summary["data"] == {
        "area_count": 1,
        "module_count": 2,
        "resource_count": 4,
        "completed": 1,
        "total": 4,
        "estimated_time": "6h",
    }
    assert area["kind"] == "roadmap_area"
    assert area["data"]["progress"] == {
        "completed": 1,
        "total": 4,
        "status": "in-progress",
        "estimated_time": "6h",
    }
    assert [m["slug"] for m in area["data"]["modules"]] == ["tool-use-basics", "agent-guardrails"]
    assert area["data"]["modules"][1]["progress"]["status"] == "planned"
    assert "resources" not in area["data"]["modules"][0]
    assert sources(result) == [
        ("roadmap", "ai-roadmap", "AI Roadmap", "/ai-roadmap"),
        ("roadmap_area", "agent-systems", "Agent systems", "/ai-roadmap/agent-systems"),
    ]
    assert blocks(result) == [
        {
            "type": "RoadmapCard",
            "title": "Agent systems",
            "summary": "Tool-using agents and their limits.",
            "href": "/ai-roadmap/agent-systems",
        }
    ]


async def test_an_area_detail_adds_its_modules_and_resources_with_their_own_sources() -> None:
    content = FakeContent()
    result, models = await run(
        [
            tools("get_roadmap"),
            tools("get_roadmap_area", args={"area": "agent-systems"}),
            draft("Tool use basics is half done.", refs=("src-3", "src-4")),
        ],
        content=content,
    )
    detail = tool_results(models, 2)[1]
    [area, basics, guardrails] = detail["records"]
    # The area keeps the ref it got from the roadmap listing.
    assert (area["ref"], area["kind"]) == ("src-2", "roadmap_area")
    assert (basics["ref"], basics["kind"]) == ("src-3", "roadmap_module")
    assert basics["data"]["area"] == "agent-systems"
    assert basics["data"]["progress"]["completed"] == 1
    assert [(r["slug"], r["status"], r["estimated_time"]) for r in basics["data"]["resources"]] == [
        ("function-calling-tutorial", "completed", "1h 30m"),
        ("agent-loop-walkthrough", "in-progress", "1h 30m"),
    ]
    assert guardrails["data"]["resources"][1]["book"] == "agent-design-notes"
    assert content.calls == ["read_roadmap", "read_roadmap_area:agent-systems"]
    assert sources(result) == [
        (
            "roadmap_module",
            "tool-use-basics",
            "Tool use basics",
            "/ai-roadmap/agent-systems/tool-use-basics",
        ),
        (
            "roadmap_module",
            "agent-guardrails",
            "Agent guardrails",
            "/ai-roadmap/agent-systems/agent-guardrails",
        ),
    ]
    assert blocks(result) == [
        {
            "type": "RoadmapCard",
            "title": "Tool use basics",
            "summary": "How a model asks for a tool.",
            "href": "/ai-roadmap/agent-systems/tool-use-basics",
        },
        {
            "type": "RoadmapCard",
            "title": "Agent guardrails",
            "summary": None,
            "href": "/ai-roadmap/agent-systems/agent-guardrails",
        },
    ]


async def test_a_missing_area_is_not_found_and_records_no_evidence() -> None:
    result, models = await run(
        [
            tools("get_roadmap_area", args={"area": "quantum-computing"}),
            draft("There is no such area.", outcome="insufficient_evidence", refs=()),
        ]
    )
    assert tool_results(models)[0]["error"] == "not_found"
    assert ("tool.get_roadmap_area", "not_found") in spans(result)
    assert [item.kind for item in result.evidence] == ["contact"]


# --- Diary and statistics -------------------------------------------------------------------------


async def test_diary_days_are_cited_on_their_own_day_page_with_formatted_times() -> None:
    result, models = await run(
        [tools("get_learning_diary"), draft("Ilsa traced an agent loop.", refs=("src-1",))]
    )
    [day, conference] = tool_results(models)[0]["records"]
    assert day["kind"] == "diary_day"
    assert day["data"]["date"] == "2026-03-10"
    assert day["data"]["notes"] == "Traced an agent loop step by step."
    assert day["data"]["total_time"] == "1h 30m"
    assert day["data"]["sessions"] == [
        {
            "resource": {
                "slug": "agent-loop-walkthrough",
                "name": "Agent loop walkthrough",
                "type": "link",
                "module": "tool-use-basics",
                "area": "agent-systems",
            },
            "event": None,
            "time": "1h 30m",
        }
    ]
    assert conference["data"]["sessions"][0]["event"]["slug"] == "port-wren-agents-conference"
    assert conference["data"]["sessions"][0]["time"] == "5h 30m"
    assert "seconds" not in json.dumps(tool_results(models))
    assert sources(result) == [
        (
            "diary_day",
            "2026-03-10",
            "Learning diary, 2026-03-10",
            "/ai-roadmap/diary/2026-03-10",
        )
    ]
    assert result.blocks == []


async def test_a_diary_longer_than_the_record_cap_is_rejected_not_truncated() -> None:
    many = [
        DIARY[0].model_copy(update={"date": datetime.date(2026, 1, 1) + datetime.timedelta(n)})
        for n in range(31)
    ]
    result, models = await run(
        [tools("get_learning_diary"), draft(outcome="refused", refs=())],
        content=FakeContent(diary=many),
    )
    assert ("tool.get_learning_diary", "too_large") in spans(result)
    assert tool_results(models)[0]["error"] == "too_large"
    assert result.evidence == []


async def test_statistics_are_one_source_with_the_api_aggregates_formatted() -> None:
    result, models = await run(
        [tools("get_learning_statistics"), draft("Ilsa logged 17h 40m in total.")]
    )
    [record] = tool_results(models)[0]["records"]
    assert record["kind"] == "statistics"
    data = record["data"]
    assert data["totals"] == {
        "total_time": "17h 40m",
        "resource_time": "7h 40m",
        "book_time": "2h 30m",
        "event_time": "7h 30m",
        "active_days": 9,
    }
    assert [(m["month"], m["total_time"]) for m in data["months"]] == [
        ("2026-02", "5h 30m"),
        ("2026-03", "6h 40m"),
    ]
    assert data["weeks"][0]["starts_on"] == "2026-03-09"
    assert data["areas"][0]["modules"][0]["total_time"] == "1h 30m"
    assert data["resources"][0]["module"] == {"slug": "tool-use-basics", "name": "Tool use basics"}
    assert data["events"][0]["total_time"] == "5h 30m"
    assert "days" not in data
    assert sources(result) == [
        ("statistics", "learning-statistics", "Learning statistics", "/ai-roadmap/diary/stats")
    ]
    assert result.blocks == []


# --- Books and events ---------------------------------------------------------------------------


async def test_a_book_keeps_its_status_and_the_reading_time_of_its_resource() -> None:
    result, models = await run([tools("list_books"), draft("Ilsa is reading the handbook.")])
    [record] = tool_results(models)[0]["records"]
    assert record["kind"] == "book"
    assert record["data"]["status"] == "reading"
    assert record["data"]["reading_time"] == "2h 30m"
    assert record["data"]["resource"]["slug"] == "handbook-reading"
    assert "reading_seconds" not in record["data"]
    assert sources(result) == [
        (
            "book",
            "search-evaluation-handbook",
            "A Fictional Handbook of Search Evaluation",
            "/ai-roadmap/bookshelf/search-evaluation-handbook",
        )
    ]
    assert result.blocks == []


async def test_an_event_keeps_its_dates_apart_from_the_logged_attendance_time() -> None:
    result, models = await run([tools("list_events"), draft("Ilsa attended the conference.")])
    [record] = tool_results(models)[0]["records"]
    assert record["kind"] == "event"
    assert (record["data"]["starts_on"], record["data"]["ends_on"]) == ("2026-02-19", "2026-02-20")
    assert record["data"]["attendance_time"] == "5h 30m"
    assert record["data"]["takeaways"] == "Talks by other engineers on agent evaluation."
    assert sources(result) == [
        (
            "event",
            "port-wren-agents-conference",
            "Port Wren Agents Conference",
            "/ai-roadmap/events#events-2026",
        )
    ]
    assert result.blocks == []


async def test_a_book_and_an_event_with_the_same_slug_are_distinct_sources() -> None:
    book = BOOKS[0].model_copy(update={"slug": EVENTS[0].slug})
    result, _ = await run(
        [calls(("list_books", {}), ("list_events", {})), draft(refs=("src-1", "src-2"))],
        content=FakeContent(books=[book]),
    )
    assert [(s.kind, s.record_id) for s in result.sources] == [
        ("book", "port-wren-agents-conference"),
        ("event", "port-wren-agents-conference"),
    ]


async def test_no_learning_tool_result_carries_a_url() -> None:
    _, models = await run(
        [
            calls(
                ("list_current_focus", {}),
                ("get_roadmap", {}),
                ("get_learning_diary", {}),
                ("get_learning_statistics", {}),
                ("list_books", {}),
                ("list_events", {}),
            ),
            draft(refs=()),
        ]
    )
    seen = json.dumps(tool_results(models))
    assert "http" not in seen
    assert "example.test" not in seen


# --- Bounds and failures --------------------------------------------------------------------------


async def test_duplicate_learning_identities_make_the_read_unavailable() -> None:
    result, _ = await run(
        [tools("list_events"), draft(outcome="refused", refs=())],
        content=FakeContent(events=[EVENTS[0], EVENTS[0]]),
    )
    assert ("tool.list_events", "error") in spans(result)
    assert result.evidence == []


async def test_an_oversized_roadmap_is_rejected_not_truncated() -> None:
    huge = ROADMAP.model_copy(
        update={"areas": [AGENT_AREA.model_copy(update={"description": "word " * 10_000})]}
    )
    result, models = await run(
        [tools("get_roadmap"), draft(outcome="refused", refs=())],
        content=FakeContent(roadmap=huge),
    )
    assert ("tool.get_roadmap", "too_large") in spans(result)
    assert "word word" not in json.dumps(tool_results(models))
    assert result.evidence == []


async def test_a_failed_learning_read_is_unavailable_to_the_model() -> None:
    result, models = await run(
        [
            tools("get_learning_statistics"),
            draft("No data.", outcome="insufficient_evidence", refs=()),
        ],
        content=FakeContent(fail=True),
    )
    assert ("tool.get_learning_statistics", "error") in spans(result)
    assert tool_results(models)[0]["error"] == "unavailable"


# --- The caller's calendar day ----------------------------------------------------------------


async def test_the_callers_day_is_given_to_the_main_stage_only_when_set() -> None:
    _, dated = await run([draft(refs=())], today=datetime.date(2026, 3, 12))
    _, undated = await run([draft(refs=())])
    first = str(dated.stage_calls("main")[0][1][1].content)
    assert "<today>2026-03-12</today>" in first
    assert "<today>" not in str(undated.stage_calls("main")[0][1][1].content)
