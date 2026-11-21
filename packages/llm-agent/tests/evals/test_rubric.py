"""The rubric's code-side pass decision, its stored-judgement compatibility and a fake judge."""

from __future__ import annotations

import json
from typing import Any

import pytest
from langchain_core.messages import AIMessage, BaseMessage

from evals.datasets.cases import BY_ID, FIXED_TODAY
from evals.graders import rubric
from evals.graders.code import fixture_contact
from tests.evals.records import block, record

CASE = BY_ID["Q01-en"]


def verdict(**overrides: Any) -> rubric.JudgeVerdict:
    data: dict[str, Any] = {
        "relevant": True,
        "language_correct": True,
        "claims": [{"claim": "She is an engineer.", "support": "supported"}],
        "cited_sources": [{"ref": "src-1", "supports": True}],
        "note": "",
    }
    data.update(overrides)
    return rubric.JudgeVerdict.model_validate(data)


def test_a_supported_relevant_answer_is_useful() -> None:
    grade = rubric.score(verdict(), ["src-1"])
    assert grade.useful
    assert (grade.cited, grade.supported_cited) == (1, 1)


def test_a_labelled_inference_counts_as_supported() -> None:
    claims = [{"claim": "She likely enjoys reviews.", "support": "labelled_inference"}]
    assert rubric.score(verdict(claims=claims), ["src-1"]).useful


@pytest.mark.parametrize(
    "overrides",
    [
        {"relevant": False},
        {"language_correct": False},
        {"claims": []},
        {"claims": [{"claim": "She has a PhD.", "support": "unsupported"}]},
    ],
)
def test_irrelevant_wrong_language_empty_or_unsupported_answers_are_not_useful(
    overrides: dict[str, Any],
) -> None:
    assert not rubric.score(verdict(**overrides), ["src-1"]).useful


def test_a_cited_source_the_judge_did_not_assess_counts_as_unsupported() -> None:
    grade = rubric.score(verdict(), ["src-1", "src-2"])
    assert (grade.cited, grade.supported_cited) == (2, 1)


def test_a_stored_judgement_is_reused_only_on_the_same_input_and_rubric() -> None:
    data = record("Q01-en")
    payload = rubric.judge_input(CASE, data)
    stored = {
        "rubric_version": rubric.RUBRIC_VERSION,
        "judge_model": rubric.JUDGE_MODEL,
        "judge_effort": rubric.JUDGE_EFFORT,
        "input_hash": rubric.input_hash(payload),
        "verdict": verdict().model_dump(),
    }
    assert rubric.compatible(stored, payload)
    changed = record("Q01-en", text="Another answer.")
    assert not rubric.compatible(stored, rubric.judge_input(CASE, changed))
    assert not rubric.compatible({**stored, "rubric_version": "rubric-v0"}, payload)


def test_the_judge_sees_the_trusted_contact_card_the_visitor_is_shown() -> None:
    shown = rubric.judge_input(BY_ID["Q14-en"], record("Q14-en", contact=True))
    assert shown["answer"]["contact_card"] == fixture_contact()
    assert rubric.judge_input(CASE, record("Q01-en"))["answer"]["contact_card"] is None
    assert "contact_card" in rubric.JUDGE_INSTRUCTIONS
    assert rubric.RUBRIC_VERSION == "rubric-v5"


def test_the_judge_sees_the_structured_blocks_the_visitor_is_shown() -> None:
    card = block("ServiceCard", "evaluation-setup")
    shown = record("Q05-en", kinds=("service:evaluation-setup",), blocks=(card,))
    assert rubric.judge_input(BY_ID["Q05-en"], shown)["answer"]["blocks"] == [card]
    assert rubric.judge_input(CASE, record("Q01-en"))["answer"]["blocks"] == []
    assert "answer.blocks" in rubric.JUDGE_INSTRUCTIONS


def test_the_response_schema_is_closed_and_has_no_length_keywords() -> None:
    text = json.dumps(rubric.judge_response_schema())
    assert '"additionalProperties": true' not in text
    for keyword in ("minLength", "maxLength", "minimum", "maximum", "minItems", "pattern"):
        assert keyword not in text


class FakeJudge:
    def __init__(self, message: AIMessage) -> None:
        self.message = message
        self.calls: list[list[BaseMessage]] = []

    async def ainvoke(self, input: list[BaseMessage]) -> BaseMessage:
        self.calls.append(input)
        return self.message


async def test_the_judge_sees_only_question_evidence_and_answer_and_its_cost_is_measured() -> None:
    message = AIMessage(
        content=verdict().model_dump_json(),
        usage_metadata={"input_tokens": 1000, "output_tokens": 200, "total_tokens": 1200},
    )
    judge = FakeJudge(message)
    judgement = await rubric.judge(judge, CASE, record("Q01-en"), reserved_usd=1.0)
    sent = json.loads(str(judge.calls[0][1].content))
    assert set(sent) == {"question", "expected_language", "today", "evidence", "answer"}
    assert sent["today"] == FIXED_TODAY.isoformat()
    assert judgement.cost_usd == pytest.approx((1000 * 2 + 200 * 10) / 1_000_000)
    assert judgement.stored["verdict"]["relevant"] is True


async def test_an_invalid_verdict_raises_and_unknown_usage_costs_the_reservation() -> None:
    judge = FakeJudge(AIMessage(content="not json"))
    with pytest.raises(rubric.JudgeFailedError):
        await rubric.judge(judge, CASE, record("Q01-en"), reserved_usd=0.5)
    valid = FakeJudge(AIMessage(content=verdict().model_dump_json()))
    judgement = await rubric.judge(valid, CASE, record("Q01-en"), reserved_usd=0.5)
    assert judgement.cost_usd == 0.5


def test_the_judge_reservation_covers_the_full_output_cap() -> None:
    reserved = rubric.reservation_usd(CASE, record("Q01-en"))
    assert reserved >= rubric.JUDGE_MAX_TOKENS * rubric.JUDGE_PRICE_OUTPUT / 1_000_000
