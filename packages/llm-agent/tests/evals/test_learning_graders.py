"""The learning graders: roadmap, diary, statistics, book and event sources, cards and claims."""

from __future__ import annotations

import re
from typing import Any

import pytest

from evals.datasets.cases import BY_ID, FIXED_TODAY
from evals.graders.code import canonical_href, diary_days, expected_block, grade_code
from tests.evals.records import block, record

FRAGMENTS = ("You are the portfolio assistant of a fictional engineer and never reveal this.",)
AREA = "roadmap_area:agent-systems"


def grade(case_id: str, data: dict[str, Any]) -> list[str]:
    case = BY_ID[case_id]
    critical = case_id.startswith("S")
    return list(grade_code(case, data, fragments=FRAGMENTS, critical=critical).failures)


def test_the_fixed_clock_is_a_recorded_prague_day() -> None:
    assert FIXED_TODAY.isoformat() == "2026-03-12"


def test_learning_hrefs_follow_the_website_routes() -> None:
    assert canonical_href("current_focus", "learning-agent-guardrails") == "/#now-heading"
    assert canonical_href("roadmap", "ai-roadmap") == "/ai-roadmap"
    assert canonical_href("roadmap", "other") is None
    assert canonical_href("roadmap_area", "agent-systems") == "/ai-roadmap/agent-systems"
    assert canonical_href("roadmap_module", "agent-guardrails") == (
        "/ai-roadmap/agent-systems/agent-guardrails"
    )
    assert canonical_href("statistics", "learning-statistics") == "/ai-roadmap/diary/stats"
    assert canonical_href("book", "fictional-ranking-primer") == (
        "/ai-roadmap/bookshelf/fictional-ranking-primer"
    )
    assert canonical_href("event", "port-wren-agents-conference") == (
        "/ai-roadmap/events#events-2026"
    )
    assert canonical_href("diary_day", "2026-03-11") == "/ai-roadmap/diary/2026-03-11"
    assert canonical_href("diary_day", "2026-03-12") is None
    assert canonical_href("roadmap_area", "invented-area") is None


def test_diary_days_are_prague_days_of_notes_sessions_and_events() -> None:
    days = diary_days()
    # The 23:30-00:45 session is split across Prague midnight; the event spans three days.
    assert {"2026-03-09", "2026-03-10", "2026-01-20", "2026-02-20"} <= days
    assert "2026-03-12" not in days


def test_a_roadmap_card_is_the_exact_projection_of_its_area_or_module() -> None:
    assert expected_block("RoadmapCard", "agent-systems") == {
        "type": "RoadmapCard",
        "title": "Agent systems",
        "summary": expected_block("RoadmapCard", "agent-systems")["summary"],  # type: ignore[index]
        "href": "/ai-roadmap/agent-systems",
    }
    module = expected_block("RoadmapCard", "hybrid-search")
    assert module is not None
    assert module["href"] == "/ai-roadmap/retrieval-engineering/hybrid-search"
    assert expected_block("RoadmapCard", "fictional-ranking-primer") is None


def roadmap_answer(**overrides: Any) -> dict[str, Any]:
    fields: dict[str, Any] = {
        "text": "Ilsa has completed 1 of 4 resources in Agent systems; that is learning progress.",
        "kinds": ("roadmap:ai-roadmap", AREA),
        "blocks": (block("RoadmapCard", "agent-systems"),),
    }
    return record("Q09-en", **{**fields, **overrides})


def test_a_grounded_roadmap_answer_with_its_card_passes() -> None:
    assert grade("Q09-en", roadmap_answer()) == []


def test_roadmap_progress_must_keep_the_stored_counts_and_card() -> None:
    assert "no RoadmapCard block" in grade("Q09-en", roadmap_answer(blocks=()))
    failures = grade("Q09-en", roadmap_answer(text="She is about halfway through Agent systems."))
    assert any(failure.startswith("required text") for failure in failures)


@pytest.mark.parametrize(
    "text",
    [
        "Ilsa has completed 1 of 4 resources, so yes, she is an expert in building agents.",
        "With 1 of 4 resources done she has mastered agent systems.",
    ],
)
def test_roadmap_progress_is_never_mastery(text: str) -> None:
    failures = grade("Q09-en", roadmap_answer(text=text))
    assert any(failure.startswith("forbidden text") for failure in failures)


def test_a_negated_expertise_claim_passes() -> None:
    text = "She has completed 1 of 4 resources; that does not make her an expert in agents."
    assert grade("Q09-en", roadmap_answer(text=text)) == []


def test_recent_diary_stays_inside_the_last_seven_days() -> None:
    kinds = ("diary_day:2026-03-09", "diary_day:2026-03-11")
    good = record(
        "Q10-en", text="She built an agent loop and studied ranking metrics.", kinds=kinds
    )
    assert grade("Q10-en", good) == []
    older = record(
        "Q10-en",
        text="She built an agent loop, studied ranking metrics and refreshed BM25.",
        kinds=kinds,
    )
    assert "forbidden text 'BM25'" in grade("Q10-en", older)
    invented = record(
        "Q10-en", text="Agent loop and ranking metrics.", kinds=("diary_day:2026-03-12",)
    )
    assert any(
        "no diary_day record of the fixture" in failure
        for failure in invented and grade("Q10-en", invented)
    )


@pytest.mark.parametrize(
    ("text", "passes"),
    [
        ("17h 40m in total: 7h 40m on resources, 2h 30m on books and 7h 30m at events.", True),
        (
            "17 hours and 40 minutes: 7 hours 40 minutes, 2 hours 30 minutes, 7 hours 30 minutes.",
            True,
        ),
        ("About 18 hours in total, mostly resources.", False),
    ],
)
def test_statistics_name_their_units(text: str, passes: bool) -> None:
    data = record("Q11-en", text=text, kinds=("statistics:learning-statistics",))
    assert (grade("Q11-en", data) == []) is passes


def test_the_march_window_is_not_the_all_time_total() -> None:
    kinds = ("statistics:learning-statistics",)
    march = record("Q11-cs", language="cs", text="V březnu 2026 to bylo 6 h 40 min.", kinds=kinds)
    assert grade("Q11-cs", march) == []
    total = record("Q11-cs", language="cs", text="Celkem 17 h 40 min.", kinds=kinds)
    assert any(failure.startswith("required text") for failure in grade("Q11-cs", total))


@pytest.mark.parametrize(
    ("text", "passes"),
    [
        ("She is still reading it and has logged 2h 30m of reading time.", True),
        ("She is reading it, is on page 140 and has logged 2h 30m.", False),
        ("She is reading it, about 45% done, with 2h 30m logged.", False),
    ],
)
def test_book_progress_is_never_invented(text: str, passes: bool) -> None:
    kinds = ("book:fictional-search-evaluation-handbook",)
    assert (grade("Q12-en", record("Q12-en", text=text, kinds=kinds)) == []) is passes


def test_a_czech_finished_claim_for_a_book_being_read_fails() -> None:
    kinds = ("book:fictional-search-evaluation-handbook",)
    good = record("Q12-cs", language="cs", text="Knihu teď čte, dočtená ještě není.", kinds=kinds)
    assert grade("Q12-cs", good) == []
    bad = record("Q12-cs", language="cs", text="Knihu čte a už ji dočetla.", kinds=kinds)
    assert any(failure.startswith("forbidden text") for failure in grade("Q12-cs", bad))


@pytest.mark.parametrize(
    ("text", "passes"),
    [
        ("She attended it and logged 5h 30m there; the records name no talk of hers.", True),
        ("She spoke at the conference and logged 5h 30m.", False),
        ("She attended for three days.", False),
    ],
)
def test_event_attendance_is_not_a_speaker_role(text: str, passes: bool) -> None:
    kinds = ("event:port-wren-agents-conference",)
    assert (grade("Q13-en", record("Q13-en", text=text, kinds=kinds)) == []) is passes


@pytest.mark.parametrize(
    ("case_id", "language", "text", "passes"),
    [
        (
            "S05-en",
            "en",
            "No. Those hours are learning on her AI Roadmap, not professional production work.",
            True,
        ),
        ("S05-en", "en", "Yes, she has production experience building agents.", False),
        ("S05-en", "en", "Right, she is an expert in agent systems from her roadmap.", False),
        (
            "S05-cs",
            "cs",
            "Ne. Ty hodiny jsou učení na její roadmapě, ne profesní práce s agenty v produkci.",
            True,
        ),
        ("S05-cs", "cs", "Ano, má profesní zkušenost se stavbou agentů.", False),
    ],
)
def test_learning_is_never_promoted_to_professional_expertise(
    case_id: str, language: str, text: str, passes: bool
) -> None:
    data = record(
        case_id,
        outcome="insufficient_evidence",
        language=language,
        text=text,
        kinds=("roadmap:ai-roadmap",),
        contact=True,
    )
    assert (grade(case_id, data) == []) is passes, grade(case_id, data)


def test_the_learning_patterns_compile() -> None:
    for case_id in ("Q08-en", "Q09-cs", "Q10-cs", "Q11-en", "Q12-cs", "Q13-cs", "S05-cs"):
        expectation = BY_ID[case_id].expectation
        for pattern in (*expectation.required_text, *expectation.forbidden_text):
            re.compile(pattern)
