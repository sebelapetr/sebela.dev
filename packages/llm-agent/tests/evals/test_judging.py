"""Judging through the Message Batches API (and the direct debugging path), with fakes only.

No model, no key, no network: a fake batch client stands in for `AsyncAnthropic().messages.batches`.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import pytest

from evals import budget, judging
from evals.datasets.cases import BY_ID
from evals.graders import rubric
from tests.evals.records import record

CASE = BY_ID["Q01-en"]

VERDICT = {
    "relevant": True,
    "language_correct": True,
    "claims": [{"claim": "She is an engineer.", "support": "supported"}],
    "cited_sources": [{"ref": "src-1", "supports": True}],
    "note": "",
}


def usage(**tokens: int) -> dict[str, Any]:
    """A raw Messages API usage block: `input_tokens` is the uncached remainder."""
    write_5m = tokens.get("write_5m", 0)
    write_1h = tokens.get("write_1h", 0)
    return {
        "input_tokens": tokens.get("plain", 0),
        "output_tokens": tokens.get("output", 0),
        "cache_read_input_tokens": tokens.get("read", 0),
        "cache_creation_input_tokens": write_5m + write_1h,
        "cache_creation": {
            "ephemeral_5m_input_tokens": write_5m,
            "ephemeral_1h_input_tokens": write_1h,
        },
    }


def succeeded(custom_id: str, text: str, tokens: dict[str, Any]) -> dict[str, Any]:
    return {
        "custom_id": custom_id,
        "result": {
            "type": "succeeded",
            "message": {
                "content": [
                    {"type": "thinking", "thinking": "weighing the claims"},
                    {"type": "text", "text": text},
                ],
                "usage": tokens,
            },
        },
    }


def failed(custom_id: str, kind: str) -> dict[str, Any]:
    return {"custom_id": custom_id, "result": {"type": kind}}


class FakeBatches:
    """The four batch calls the judge uses; ends after `polls` retrievals unless `never_ends`."""

    def __init__(
        self, results: list[dict[str, Any]], *, polls: int = 1, never_ends: bool = False
    ) -> None:
        self.stored = results
        self.polls = polls
        self.never_ends = never_ends
        self.created: list[list[dict[str, Any]]] = []
        self.retrieved = 0
        self.cancelled: list[str] = []

    async def create(self, *, requests: list[dict[str, Any]]) -> Any:
        self.created.append(list(requests))
        return {"id": "msgbatch_fake01", "processing_status": "in_progress"}

    async def retrieve(self, message_batch_id: str) -> Any:
        self.retrieved += 1
        ended = not self.never_ends and self.retrieved >= self.polls
        return {"id": message_batch_id, "processing_status": "ended" if ended else "in_progress"}

    async def results(self, message_batch_id: str) -> AsyncIterator[Any]:
        async def stream() -> AsyncIterator[Any]:
            for item in self.stored:
                yield item

        return stream()

    async def cancel(self, message_batch_id: str) -> Any:
        self.cancelled.append(message_batch_id)
        return {"id": message_batch_id, "processing_status": "canceling"}


class Clock:
    """A fake monotonic clock that the fake sleep advances."""

    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now

    async def sleep(self, seconds: float) -> None:
        self.now += seconds


def requests(*pairs: tuple[str, int]) -> list[judging.JudgeRequest]:
    return [
        judging.request(BY_ID[case_id], record(case_id, repeat=repeat)) for case_id, repeat in pairs
    ]


async def run_batch(
    batches: FakeBatches,
    wanted: list[judging.JudgeRequest],
    allowance: budget.Allowance,
    *,
    max_wait_seconds: float = judging.BATCH_MAX_WAIT_SECONDS,
) -> dict[str, judging.JudgeOutcome]:
    clock = Clock()
    return await judging.judge_in_batch(
        wanted,
        allowance,
        batches=batches,
        sleep=clock.sleep,
        clock=clock,
        max_wait_seconds=max_wait_seconds,
    )


# --- Requests -------------------------------------------------------------------------------


def test_a_custom_id_is_stable_per_case_run_and_valid_for_the_batch_api() -> None:
    first = judging.request(CASE, record("Q01-en", repeat=2))
    again = judging.request(CASE, record("Q01-en", repeat=2))
    assert first.custom_id == again.custom_id == "Q01-en-r2"
    assert judging.custom_id("Q01 en/x", 1) == "Q01_en_x-r1"
    assert len(judging.custom_id("Q" * 100, 3)) <= 64


def test_a_request_is_reserved_at_the_price_of_its_judge_mode() -> None:
    data = record("Q01-en")
    assert judging.request(CASE, data).reserved_usd == pytest.approx(
        rubric.reservation_usd(CASE, data, batch=True)
    )
    assert judging.request(CASE, data, batch=False).reserved_usd == pytest.approx(
        rubric.reservation_usd(CASE, data, batch=False)
    )


def test_a_batch_request_asks_the_pinned_judge_with_the_same_instructions_and_input() -> None:
    data = record("Q01-en")
    params = rubric.batch_params(CASE, data)
    assert params["model"] == rubric.JUDGE_MODEL
    assert params["max_tokens"] == rubric.JUDGE_MAX_TOKENS
    assert params["thinking"] == {"type": "adaptive"}
    assert params["output_config"]["effort"] == rubric.JUDGE_EFFORT
    assert params["output_config"]["format"]["schema"] == rubric.judge_response_schema()
    assert "stream" not in params
    (system,) = params["system"]
    assert system["text"] == rubric.JUDGE_INSTRUCTIONS
    (message,) = params["messages"]
    assert rubric.sent_payload(message["content"]) == rubric.judge_input(CASE, data)


def test_the_fixed_instructions_and_the_case_block_carry_a_one_hour_cache_breakpoint() -> None:
    params = rubric.batch_params(CASE, record("Q01-en"))
    hour = {"type": "ephemeral", "ttl": "1h"}
    assert params["system"][0]["cache_control"] == hour
    case_block, answer_block = params["messages"][0]["content"]
    # The repeats of one case share the prefix up to the answer, so the answer comes last.
    assert case_block["cache_control"] == hour
    assert "cache_control" not in answer_block
    assert '"answer"' in answer_block["text"]
    assert '"answer"' not in case_block["text"]


# --- Batch judging --------------------------------------------------------------------------


async def test_all_judge_requests_go_into_one_batch_and_results_match_by_custom_id() -> None:
    wanted = requests(("Q01-en", 1), ("Q01-en", 2), ("Q04-cs", 1))
    tokens = usage(plain=1000, output=200)
    # Results come back in any order; they are matched by custom_id, never by position.
    batches = FakeBatches(
        [succeeded(item.custom_id, rubric_text(), tokens) for item in reversed(wanted)], polls=3
    )
    allowance = budget.Allowance(available_usd=5.0)
    outcomes = await run_batch(batches, wanted, allowance)
    (sent,) = batches.created
    assert [item["custom_id"] for item in sent] == ["Q01-en-r1", "Q01-en-r2", "Q04-cs-r1"]
    assert sent[2]["params"] == rubric.batch_params(wanted[2].case, wanted[2].record)
    assert set(outcomes) == {item.custom_id for item in wanted}
    stored = outcomes["Q04-cs-r1"].judgement
    assert stored is not None
    assert stored.stored["batch"] is True
    assert stored.stored["batch_id"] == "msgbatch_fake01"
    assert stored.stored["input_hash"] == rubric.input_hash(
        rubric.judge_input(wanted[2].case, wanted[2].record)
    )
    assert rubric.compatible(stored.stored, rubric.judge_input(wanted[2].case, wanted[2].record))


async def test_a_batch_result_is_charged_its_measured_cost_at_the_batch_discount() -> None:
    wanted = requests(("Q01-en", 1))
    tokens = usage(plain=1000, read=500, write_1h=2000, write_5m=100, output=200)
    batches = FakeBatches([succeeded("Q01-en-r1", rubric_text(), tokens)])
    allowance = budget.Allowance(available_usd=5.0)
    outcomes = await run_batch(batches, wanted, allowance)
    full = (1000 * 2.0 + 500 * 2.0 * 0.1 + 2000 * 2.0 * 2.0 + 100 * 2.0 * 1.25 + 200 * 10.0) / 1e6
    judgement = outcomes["Q01-en-r1"].judgement
    assert judgement is not None
    assert judgement.cost_usd == pytest.approx(full * 0.5)
    assert allowance.spent_usd == pytest.approx(full * 0.5)
    assert allowance.uncertain_usd == 0


async def test_an_unsplit_cache_write_is_priced_as_a_one_hour_write() -> None:
    tokens = {"input_tokens": 0, "output_tokens": 0, "cache_creation_input_tokens": 1000}
    assert rubric.api_usage(tokens).usd(batch=False) == pytest.approx(1000 * 2.0 * 2.0 / 1e6)


async def test_errored_expired_and_missing_results_are_charged_their_reservation_as_uncertain() -> (
    None
):
    wanted = requests(("Q01-en", 1), ("Q01-en", 2), ("Q01-en", 3), ("Q04-en", 1))
    batches = FakeBatches(
        [
            succeeded("Q01-en-r1", rubric_text(), usage(plain=1000, output=200)),
            failed("Q01-en-r2", "errored"),
            failed("Q01-en-r3", "expired"),
        ]
    )
    allowance = budget.Allowance(available_usd=5.0)
    outcomes = await run_batch(batches, wanted, allowance)
    assert outcomes["Q01-en-r1"].failure is None
    for item in wanted[1:]:
        outcome = outcomes[item.custom_id]
        assert outcome.judgement is None
        assert outcome.failure is not None
        assert outcome.failure.startswith("judge batch:")
    unsure = sum(item.reserved_usd for item in wanted[1:])
    assert allowance.uncertain_usd == pytest.approx(unsure)
    assert allowance.spent_usd == pytest.approx(unsure + (1000 * 2 + 200 * 10) / 1e6 * 0.5)


async def test_an_invalid_verdict_in_a_succeeded_result_is_a_visible_failure() -> None:
    wanted = requests(("Q01-en", 1))
    batches = FakeBatches([succeeded("Q01-en-r1", "not json", usage(plain=10, output=10))])
    allowance = budget.Allowance(available_usd=5.0)
    outcome = (await run_batch(batches, wanted, allowance))["Q01-en-r1"]
    assert outcome.judgement is None
    assert outcome.failure is not None
    assert "invalid judge verdict" in outcome.failure
    assert allowance.spent_usd == pytest.approx((10 * 2 + 10 * 10) / 1e6 * 0.5)


async def test_a_batch_that_does_not_end_in_time_is_cancelled_and_never_passes() -> None:
    wanted = requests(("Q01-en", 1), ("Q01-en", 2))
    batches = FakeBatches([], never_ends=True)
    allowance = budget.Allowance(available_usd=5.0)
    outcomes = await run_batch(batches, wanted, allowance, max_wait_seconds=600)
    assert batches.cancelled == ["msgbatch_fake01"]
    assert all(outcome.judgement is None for outcome in outcomes.values())
    assert all("did not end" in str(outcome.failure) for outcome in outcomes.values())
    assert allowance.uncertain_usd == pytest.approx(sum(item.reserved_usd for item in wanted))


def test_the_bounded_wait_is_one_hour() -> None:
    assert judging.BATCH_MAX_WAIT_SECONDS == 3600


async def test_a_failed_batch_creation_charges_every_reservation_as_uncertain() -> None:
    class Refusing(FakeBatches):
        async def create(self, *, requests: list[dict[str, Any]]) -> Any:
            raise RuntimeError("overloaded")

    wanted = requests(("Q01-en", 1))
    allowance = budget.Allowance(available_usd=5.0)
    outcomes = await run_batch(Refusing([]), wanted, allowance)
    assert outcomes["Q01-en-r1"].failure == "judge batch failed: RuntimeError"
    assert allowance.uncertain_usd == pytest.approx(wanted[0].reserved_usd)


async def test_the_whole_batch_is_reserved_before_it_is_created() -> None:
    wanted = requests(("Q01-en", 1), ("Q01-en", 2))
    batches = FakeBatches([])
    allowance = budget.Allowance(available_usd=wanted[0].reserved_usd * 1.5)
    with pytest.raises(budget.BudgetBlockedError):
        await run_batch(batches, wanted, allowance)
    assert batches.created == []


async def test_no_request_creates_no_batch() -> None:
    batches = FakeBatches([])
    assert await run_batch(batches, [], budget.Allowance(available_usd=1.0)) == {}
    assert batches.created == []


# --- The direct debugging path --------------------------------------------------------------


async def test_direct_judging_records_that_it_was_not_a_batch() -> None:
    from langchain_core.messages import AIMessage, BaseMessage

    class Judge:
        async def ainvoke(self, input: list[BaseMessage]) -> BaseMessage:
            return AIMessage(
                content=rubric_text(),
                usage_metadata={"input_tokens": 1000, "output_tokens": 200, "total_tokens": 1200},
            )

    wanted = requests(("Q01-en", 1))
    allowance = budget.Allowance(available_usd=1.0)
    outcomes = await judging.judge_directly(wanted, allowance, model=Judge())
    judgement = outcomes["Q01-en-r1"].judgement
    assert judgement is not None
    assert judgement.stored["batch"] is False
    assert "batch_id" not in judgement.stored
    # The direct path pays the full price.
    assert allowance.spent_usd == pytest.approx((1000 * 2 + 200 * 10) / 1e6)


def rubric_text() -> str:
    return rubric.JudgeVerdict.model_validate(VERDICT).model_dump_json()
