"""The paid-run controls of `command_run`, driven with fakes only (no model, no key, no API).

Runs that never started are not charged; a run is split into an early chunk of 6 case-runs and
bounded chunks of about 12, each reserved just before it starts; an anomaly in the early chunk or
an allowance that no longer covers the next chunk stops it with the remaining cases pending;
judging goes through one batch per chunk (or the direct debugging path).
"""

from __future__ import annotations

import asyncio
import contextlib
import json
from collections.abc import AsyncIterator, Callable, Mapping
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from evals import budget, judging, run
from evals.catalogue import implemented
from evals.datasets.cases import BY_ID as CASES
from evals.graders import code, rubric
from tests.evals.records import record

VERDICT = {
    "relevant": True,
    "language_correct": True,
    "claims": [{"claim": "She is an engineer.", "support": "supported"}],
    "cited_sources": [{"ref": "src-1", "supports": True}],
    "note": "",
}
TOKENS = {"input_tokens": 1000, "output_tokens": 200}
P6 = budget.campaign("06-llm-agent")
P7 = budget.campaign("07-ai-service")


def verdict_text() -> str:
    return rubric.JudgeVerdict.model_validate(VERDICT).model_dump_json()


class AnsweringBatches:
    """A fake batch client that answers every created request (or errors the named ones)."""

    def __init__(self, errored: tuple[str, ...] = ()) -> None:
        self.errored = errored
        self.created: list[list[dict[str, Any]]] = []

    async def create(self, *, requests: list[dict[str, Any]]) -> Any:
        self.created.append(list(requests))
        return {"id": f"msgbatch_fake{len(self.created):02d}", "processing_status": "in_progress"}

    async def retrieve(self, message_batch_id: str) -> Any:
        return {"id": message_batch_id, "processing_status": "ended"}

    async def results(self, message_batch_id: str) -> AsyncIterator[Any]:
        sent = self.created[int(message_batch_id[-2:]) - 1]

        async def stream() -> AsyncIterator[Any]:
            for item in sent:
                if item["custom_id"] in self.errored:
                    yield {"custom_id": item["custom_id"], "result": {"type": "errored"}}
                    continue
                yield {
                    "custom_id": item["custom_id"],
                    "result": {
                        "type": "succeeded",
                        "message": {
                            "content": [{"type": "text", "text": verdict_text()}],
                            "usage": TOKENS,
                        },
                    },
                }

        return stream()

    async def cancel(self, message_batch_id: str) -> Any:
        return {"id": message_batch_id, "processing_status": "canceling"}


@pytest.fixture(autouse=True)
def fixed_prompt_fragments(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(code, "prompt_fragments", lambda: ("A fixed system prompt line.",))
    # The fake batches end at their first status check; do not wait between checks.
    monkeypatch.setattr(judging, "POLL_SECONDS", 0.0)


@pytest.fixture
def paid(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> dict[str, Any]:
    """`command_run` with a fake test API, Promptfoo and batch client.

    `seen["answer"]` builds the record of one case-run; the fake Promptfoo answers exactly the
    cases its environment names, `repeats` times each, like the provider does.
    `seen["on_promptfoo"]` is called with the number of each Promptfoo run as it starts (to move
    a clock or to interrupt the run).
    """
    batches = AnsweringBatches()
    seen: dict[str, Any] = {
        "promptfoo": [],
        "answer": lambda case_id, repeat: record(case_id, repeat=repeat),
        "batches": batches,
        "person": {"name": "fixed"},
        "api_starts": 0,
    }
    monkeypatch.setenv("ANTHROPIC_API_KEY", "fake-key-never-used-0000")
    monkeypatch.setattr(run, "REPORT_ROOT", tmp_path / "reports")
    monkeypatch.setattr(run, "LEDGER", tmp_path / "reports" / "ledger.json")

    @contextlib.asynccontextmanager
    async def api(scratch: Path) -> AsyncIterator[Any]:
        seen["api_starts"] += 1
        if seen.get("api_fails"):
            raise RuntimeError("the test API did not start")
        yield SimpleNamespace(url="http://fake.invalid")

    async def person(url: str) -> dict[str, Any]:
        if seen.get("person_fails"):
            raise RuntimeError("GET /v1/person answered 500")
        return dict(seen["person"])

    async def promptfoo(output: Path, env: Mapping[str, str], *, repeats: int = 3) -> None:
        cases = env["LLM_AGENT_EVAL_CASES"].split(",")
        seen["promptfoo"].append({"cases": cases, "repeats": repeats})
        hook: Callable[[int], None] | None = seen.get("on_promptfoo")
        if hook is not None:
            hook(len(seen["promptfoo"]))
        answer: Callable[[str, int], dict[str, Any]] = seen["answer"]
        results = [
            {
                "vars": {"case_id": case_id},
                "response": {"output": json.dumps(answer(case_id, repeat))},
            }
            for case_id in cases
            for repeat in range(1, repeats + 1)
        ]
        text = json.dumps({"results": {"results": results}})
        await asyncio.to_thread(output.write_text, text, encoding="utf-8")

    monkeypatch.setattr(run, "start_api", api)
    monkeypatch.setattr(run, "read_person", person)
    monkeypatch.setattr(
        run,
        "check_fixture_person",
        lambda served: [] if served == {"name": "fixed"} else ["person.name differs"],
    )
    monkeypatch.setattr(run, "run_promptfoo", promptfoo)
    monkeypatch.setattr(judging, "anthropic_batches", lambda: batches)
    return seen


def only_folder() -> Path:
    (folder,) = [path for path in run.REPORT_ROOT.iterdir() if path.is_dir()]
    return folder


def summary_of() -> dict[str, Any]:
    data: dict[str, Any] = json.loads((only_folder() / "summary.json").read_text(encoding="utf-8"))
    return data


def ledger() -> list[dict[str, Any]]:
    runs: list[dict[str, Any]] = json.loads(run.LEDGER.read_text(encoding="utf-8"))["runs"]
    return runs


# --- O4: a run that never started is not charged --------------------------------------------


@pytest.mark.parametrize("failing", ["api_fails", "person_fails", "fixture_differs"])
async def test_a_run_that_never_started_promptfoo_is_charged_nothing(
    paid: dict[str, Any], failing: str
) -> None:
    if failing == "fixture_differs":
        paid["person"] = {"name": "someone else"}
    else:
        paid[failing] = True
    assert await run.command_run(["S01-en", "S01-cs"], 1.0, campaign=P6) == run.BLOCKED
    assert paid["promptfoo"] == []
    (entry,) = ledger()
    assert entry["scope"] == "not started"
    assert entry["spent_usd"] == 0
    assert entry["uncertain_usd"] == 0
    summary = summary_of()
    assert summary["started"] is False
    assert summary["cost"]["spent_usd"] == 0
    assert summary["pass"] is False
    assert any(failure.startswith("not started:") for failure in summary["gate"]["failures"])


async def test_a_started_run_is_charged_and_records_that_it_started(paid: dict[str, Any]) -> None:
    assert await run.command_run(["S01-en"], 1.0, campaign=P6) in (0, 1)
    summary = summary_of()
    assert summary["started"] is True
    (entry,) = ledger()
    assert entry["scope"] != "not started"
    assert entry["spent_usd"] == pytest.approx(3 * 0.001)


# --- O5: an early chunk, then the rest ------------------------------------------------------


async def test_a_run_starts_with_an_early_chunk_of_six_case_runs_then_the_rest(
    paid: dict[str, Any],
) -> None:
    selected = ["S01-en", "S01-cs", "S02-en", "S02-cs", "S03-en"]
    await run.command_run(selected, 1.0, campaign=P6)
    assert [call["cases"] for call in paid["promptfoo"]] == [
        ["S01-en", "S01-cs"],
        ["S02-en", "S02-cs", "S03-en"],
    ]
    summary = summary_of()
    assert summary["pending"] == []
    assert summary["stopped"] is None
    assert len(summary["case_runs"]) == 15


async def test_a_comparison_starts_with_six_cases_at_one_repeat(paid: dict[str, Any]) -> None:
    assert run.chunks(["a", "b", "c", "d", "e", "f", "g"], repeats=1) == (
        ("a", "b", "c", "d", "e", "f"),
        ("g",),
    )
    assert run.chunks(["a", "b"], repeats=3) == (("a", "b"),)
    assert run.chunks(["a", "b", "c"], repeats=3) == (("a", "b"), ("c",))


def test_after_the_early_chunk_a_run_continues_in_chunks_of_about_twelve_case_runs() -> None:
    names = [f"c{index:02d}" for index in range(20)]
    assert [len(chunk) for chunk in run.chunks(names[:11], repeats=3)] == [2, 4, 4, 1]
    assert [len(chunk) for chunk in run.chunks(names, repeats=1)] == [6, 12, 2]
    assert run.CHUNK_CASE_RUNS == 12
    for repeats in (1, 3):
        pieces = run.chunks(names, repeats=repeats)
        assert [name for piece in pieces for name in piece] == names
        assert all(len(piece) * repeats <= run.CHUNK_CASE_RUNS for piece in pieces)


def unjudged(count: int) -> list[str]:
    ids = [case.id for case in implemented() if not CASES[case.id].expectation.judged]
    assert len(ids) >= count
    return ids[:count]


def costing(usd: float) -> Callable[[str, int], dict[str, Any]]:
    def answer(case_id: str, repeat: int) -> dict[str, Any]:
        data = record(case_id, repeat=repeat)
        data["result"]["usage"] = {**data["result"]["usage"], "cost_usd": usd}
        return data

    return answer


async def test_a_full_run_starts_under_a_realistic_allowance_and_runs_chunk_by_chunk(
    paid: dict[str, Any],
) -> None:
    selected = [case.id for case in implemented()]
    assert len(selected) == 88
    # The whole run would reserve about USD 9.18; each chunk is reserved just before it starts.
    assert run.reservation(selected) > 2.0
    assert await run.command_run(selected, 2.0, campaign=P6) in (0, 1)
    expected = run.chunks(selected, repeats=3)
    assert len(expected) > 2
    assert [tuple(call["cases"]) for call in paid["promptfoo"]] == list(expected)
    assert paid["api_starts"] == 1  # one test API serves every chunk
    summary = summary_of()
    assert summary["pending"] == []
    assert summary["stopped"] is None
    assert len(summary["case_runs"]) == 264
    (entry,) = ledger()
    assert [chunk["cases"] for chunk in entry["chunks"]] == [list(chunk) for chunk in expected]
    for chunk, piece in zip(entry["chunks"], expected, strict=True):
        assert chunk["reserved_usd"] == pytest.approx(run.reservation(piece), abs=1e-6)
    assert sum(chunk["spent_usd"] for chunk in entry["chunks"]) == pytest.approx(
        entry["spent_usd"], abs=1e-5
    )


async def test_an_allowance_exhausted_mid_run_leaves_the_rest_pending(
    paid: dict[str, Any], capsys: pytest.CaptureFixture[str]
) -> None:
    selected = unjudged(9)
    pieces = run.chunks(selected, repeats=3)
    assert [len(piece) for piece in pieces] == [2, 4, 3]
    paid["answer"] = costing(budget.SUBJECT_EXECUTION_USD)
    first, second = run.reservation(pieces[0]), run.reservation(pieces[1])
    allowance = first + second + 0.1  # the third chunk needs 0.18
    assert await run.command_run(selected, allowance, campaign=P6) == run.BLOCKED
    assert [tuple(call["cases"]) for call in paid["promptfoo"]] == [pieces[0], pieces[1]]
    assert "stopped: allowance" in capsys.readouterr().err
    summary = summary_of()
    assert summary["pending"] == list(pieces[2])
    assert summary["stopped"].startswith("allowance")
    assert summary["pass"] is False
    assert {item["case"] for item in summary["case_runs"]} == set(pieces[0] + pieces[1])
    (entry,) = ledger()
    assert entry["spent_usd"] == pytest.approx(first + second)
    assert len(entry["chunks"]) == 2


async def test_an_allowance_below_the_first_chunk_is_refused_before_anything_starts(
    paid: dict[str, Any],
) -> None:
    selected = unjudged(4)
    first = run.reservation(run.chunks(selected, repeats=3)[0])
    with pytest.raises(budget.BudgetBlockedError):
        await run.command_run(selected, first - 0.01, campaign=P6)
    assert paid["api_starts"] == 0
    assert paid["promptfoo"] == []


async def test_two_stopped_case_runs_in_the_early_chunk_stop_the_run_with_the_rest_pending(
    paid: dict[str, Any], capsys: pytest.CaptureFixture[str]
) -> None:
    def answer(case_id: str, repeat: int) -> dict[str, Any]:
        outcome = "limit_reached" if case_id == "S01-cs" else "answered"
        return record(case_id, repeat=repeat, outcome=outcome)

    paid["answer"] = answer
    selected = ["S01-en", "S01-cs", "S02-en", "S02-cs"]
    assert await run.command_run(selected, 1.0, campaign=P6) == run.BLOCKED
    assert [call["cases"] for call in paid["promptfoo"]] == [["S01-en", "S01-cs"]]
    assert "stopped:" in capsys.readouterr().err
    summary = summary_of()
    assert summary["pending"] == ["S02-en", "S02-cs"]
    assert "2 of the first 6 case-runs" in summary["stopped"]
    assert summary["pass"] is False
    assert {item["case"] for item in summary["case_runs"]} == {"S01-en", "S01-cs"}
    # The pending cases were never run and are not charged.
    (entry,) = ledger()
    assert entry["spent_usd"] == pytest.approx(6 * 0.001)


async def test_uncertain_cost_above_a_tenth_of_the_measured_cost_stops_the_run(
    paid: dict[str, Any],
) -> None:
    def answer(case_id: str, repeat: int) -> dict[str, Any]:
        data = record(case_id, repeat=repeat)
        if case_id == "S01-cs" and repeat == 1:
            data["result"]["usage"] = {"cost_usd": 0.001, "cost_uncertain": True}
        return data

    paid["answer"] = answer
    assert await run.command_run(["S01-en", "S01-cs", "S02-en"], 1.0, campaign=P6) == run.BLOCKED
    assert len(paid["promptfoo"]) == 1
    summary = summary_of()
    assert "uncertain cost" in summary["stopped"]
    assert summary["pending"] == ["S02-en"]


async def test_a_single_chunk_run_needs_no_anomaly_stop(paid: dict[str, Any]) -> None:
    paid["answer"] = lambda case_id, repeat: record(case_id, repeat=repeat, outcome="limit_reached")
    assert await run.command_run(["S01-en", "S01-cs"], 1.0, campaign=P6) == 1
    summary = summary_of()
    assert summary["stopped"] is None
    assert summary["pending"] == []


# --- O1: judging through one batch per chunk ------------------------------------------------


async def test_a_judged_run_judges_each_chunk_in_one_batch(paid: dict[str, Any]) -> None:
    await run.command_run(["Q01-en", "Q01-cs", "Q02-en"], 1.0, campaign=P6)
    batches: AnsweringBatches = paid["batches"]
    assert [len(sent) for sent in batches.created] == [6, 3]
    assert batches.created[0][0]["custom_id"] == "Q01-en-r1"
    folder = only_folder()
    stored = json.loads((folder / "answers" / "Q01-en-1.json").read_text(encoding="utf-8"))
    assert stored["judgement"]["batch"] is True
    assert stored["judgement"]["batch_id"] == "msgbatch_fake01"
    assert summary_of()["judge_mode"] == "batch"


async def test_a_failed_judge_request_in_the_early_chunk_stops_the_run(
    paid: dict[str, Any],
) -> None:
    paid["batches"].errored = ("Q01-cs-r2",)
    assert await run.command_run(["Q01-en", "Q01-cs", "Q02-en"], 1.0, campaign=P6) == run.BLOCKED
    assert len(paid["promptfoo"]) == 1
    summary = summary_of()
    assert summary["stopped"] == "1 judge request(s) failed"
    assert summary["pending"] == ["Q02-en"]
    failures = [item for item in summary["case_runs"] if item["case"] == "Q01-cs"]
    assert any(
        any(text.startswith("judge batch:") for text in item["failures"]) for item in failures
    )


async def test_the_direct_judge_mode_calls_the_judge_model_per_request(
    paid: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    from langchain_core.messages import AIMessage, BaseMessage

    calls: list[int] = []

    class Judge:
        async def ainvoke(self, input: list[BaseMessage]) -> BaseMessage:
            calls.append(1)
            return AIMessage(
                content=verdict_text(),
                usage_metadata={"input_tokens": 1000, "output_tokens": 200, "total_tokens": 1200},
            )

    monkeypatch.setattr(rubric, "anthropic_judge", lambda: Judge())
    await run.command_run(["Q01-en"], 1.0, judge_mode="direct", campaign=P6)
    assert len(calls) == 3
    assert paid["batches"].created == []
    stored = json.loads((only_folder() / "answers" / "Q01-en-1.json").read_text(encoding="utf-8"))
    assert stored["judgement"]["batch"] is False
    assert summary_of()["judge_mode"] == "direct"


# --- A paid regrade stops on anomalies too --------------------------------------------------


async def test_a_paid_regrade_stops_after_the_early_requests_when_a_judge_request_failed(
    paid: dict[str, Any], monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    from tests.evals.records import SUBJECT

    monkeypatch.setattr(run, "current_subject_versions", lambda: SUBJECT)
    source = tmp_path / "source"
    run.store_answers(
        source,
        [
            record(case_id, repeat=repeat)
            for case_id in ("Q01-en", "Q01-cs", "Q02-en")
            for repeat in (1, 2, 3)
        ],
    )
    paid["batches"].errored = ("Q01-en-r1",)
    assert (
        await run.command_regrade(source, judge=True, declared_usd=1.0, campaign=P6) == run.BLOCKED
    )
    batches: AnsweringBatches = paid["batches"]
    assert [len(sent) for sent in batches.created] == [6]
    summary = summary_of()
    assert summary["stopped"] == "1 judge request(s) failed"
    assert summary["pending"] == ["Q02-en"]


async def test_a_paid_regrade_reserves_each_chunk_and_stops_when_the_next_one_does_not_fit(
    paid: dict[str, Any], monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    from tests.evals.records import SUBJECT

    monkeypatch.setattr(run, "current_subject_versions", lambda: SUBJECT)
    judged = [case.id for case in implemented() if CASES[case.id].expectation.judged][:6]
    stored = [record(case_id, repeat=repeat) for case_id in judged for repeat in (1, 2, 3)]
    source = tmp_path / "source"
    run.store_answers(source, stored)
    pieces = run.chunks(judged, repeats=3)
    assert [len(piece) for piece in pieces] == [2, 4]
    first = sum(
        judging.request(CASES[str(item["case_id"])], item).reserved_usd
        for item in stored
        if str(item["case_id"]) in pieces[0]
    )
    assert (
        await run.command_regrade(source, judge=True, declared_usd=first + 0.05, campaign=P6)
        == run.BLOCKED
    )
    batches: AnsweringBatches = paid["batches"]
    assert [len(sent) for sent in batches.created] == [6]
    summary = summary_of()
    assert summary["stopped"].startswith("allowance")
    # The stored answers come back in file order, so compare the cases, not their order.
    assert sorted(summary["pending"]) == sorted(pieces[1])
    assert summary["pass"] is False
    (entry,) = ledger()
    assert len(entry["chunks"]) == 1
    assert sorted(entry["chunks"][0]["cases"]) == sorted(pieces[0])


# --- An interrupted chunk is counted; an overall deadline ends a run --------------------------


class Interrupted(BaseException):
    """Stands in for Ctrl-C or a killed job: it escapes every `except Exception`."""


async def test_an_interrupted_chunk_is_counted_at_its_reservation_in_the_ledger(
    paid: dict[str, Any],
) -> None:
    selected = unjudged(9)
    pieces = run.chunks(selected, repeats=3)
    paid["answer"] = costing(0.01)

    def interrupt_the_second_chunk(call: int) -> None:
        if call == 2:
            raise Interrupted

    paid["on_promptfoo"] = interrupt_the_second_chunk
    with pytest.raises(Interrupted):
        await run.command_run(selected, 2.0, campaign=P6)
    (entry,) = ledger()
    second = run.reservation(pieces[1])
    assert entry["scope"] == "running"
    assert entry["provisional_usd"] == pytest.approx(second, abs=1e-6)
    assert entry["spent_usd"] == pytest.approx(6 * 0.01 + second, abs=1e-5)
    assert entry["uncertain_usd"] == pytest.approx(second, abs=1e-5)
    assert [chunk["cases"] for chunk in entry["chunks"]] == [list(pieces[0]), list(pieces[1])]
    assert entry["chunks"][1]["provisional"] is True
    assert budget.ledger_spent(run.LEDGER, "06-llm-agent") == pytest.approx(entry["spent_usd"])


async def test_an_interrupted_regrade_chunk_is_counted_at_its_reservation_in_the_ledger(
    paid: dict[str, Any], monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    from tests.evals.records import SUBJECT

    monkeypatch.setattr(run, "current_subject_versions", lambda: SUBJECT)
    judged = [case.id for case in implemented() if CASES[case.id].expectation.judged][:6]
    stored = [record(case_id, repeat=repeat) for case_id in judged for repeat in (1, 2, 3)]
    source = tmp_path / "source"
    run.store_answers(source, stored)
    pieces = run.chunks(judged, repeats=3)

    class InterruptingSecondBatch(AnsweringBatches):
        async def create(self, *, requests: list[dict[str, Any]]) -> Any:
            if self.created:
                raise Interrupted
            return await super().create(requests=requests)

    batches = InterruptingSecondBatch()
    monkeypatch.setattr(judging, "anthropic_batches", lambda: batches)
    with pytest.raises(Interrupted):
        await run.command_regrade(source, judge=True, declared_usd=2.0, campaign=P6)
    second = sum(
        judging.request(CASES[str(item["case_id"])], item).reserved_usd
        for item in stored
        if str(item["case_id"]) in pieces[1]
    )
    (entry,) = ledger()
    assert entry["provisional_usd"] == pytest.approx(second, abs=1e-6)
    assert entry["uncertain_usd"] == pytest.approx(second, abs=1e-5)
    assert len(entry["chunks"]) == 2
    assert entry["spent_usd"] == pytest.approx(entry["chunks"][0]["spent_usd"] + second, abs=1e-5)


async def test_a_run_past_its_deadline_leaves_the_remaining_chunks_pending(
    paid: dict[str, Any], monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    selected = unjudged(9)
    pieces = run.chunks(selected, repeats=3)
    now = [0.0]
    monkeypatch.setattr(run, "clock", lambda: now[0])

    def forty_seconds_per_chunk(call: int) -> None:
        now[0] += 40.0

    paid["on_promptfoo"] = forty_seconds_per_chunk
    assert await run.command_run(selected, 2.0, deadline_minutes=1.0, campaign=P6) == run.BLOCKED
    assert [tuple(call["cases"]) for call in paid["promptfoo"]] == [pieces[0], pieces[1]]
    assert "stopped: deadline" in capsys.readouterr().err
    summary = summary_of()
    assert summary["pending"] == list(pieces[2])
    assert summary["stopped"].startswith("deadline")
    assert summary["pass"] is False
    (entry,) = ledger()
    assert entry["scope"] not in ("running", "not started")
    assert len(entry["chunks"]) == 2
    # Each finished chunk replaced its provisional charge with what it measured.
    assert "provisional_usd" not in entry
    assert not any(chunk.get("provisional") for chunk in entry["chunks"])


async def test_a_paid_regrade_past_its_deadline_leaves_the_remaining_chunks_pending(
    paid: dict[str, Any], monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    from tests.evals.records import SUBJECT

    monkeypatch.setattr(run, "current_subject_versions", lambda: SUBJECT)
    judged = [case.id for case in implemented() if CASES[case.id].expectation.judged][:6]
    stored = [record(case_id, repeat=repeat) for case_id in judged for repeat in (1, 2, 3)]
    source = tmp_path / "source"
    run.store_answers(source, stored)
    pieces = run.chunks(judged, repeats=3)
    now = [0.0]
    monkeypatch.setattr(run, "clock", lambda: now[0])

    class SlowBatches(AnsweringBatches):
        async def create(self, *, requests: list[dict[str, Any]]) -> Any:
            now[0] += 120.0
            return await super().create(requests=requests)

    batches = SlowBatches()
    monkeypatch.setattr(judging, "anthropic_batches", lambda: batches)
    assert (
        await run.command_regrade(
            source, judge=True, declared_usd=2.0, deadline_minutes=1.0, campaign=P6
        )
        == run.BLOCKED
    )
    assert [len(sent) for sent in batches.created] == [6]
    summary = summary_of()
    assert summary["stopped"].startswith("deadline")
    assert sorted(summary["pending"]) == sorted(pieces[1])
    (entry,) = ledger()
    assert len(entry["chunks"]) == 1
    assert "provisional_usd" not in entry


# --- A ceiling per phase campaign (issue #371) ------------------------------------------------


async def test_an_issue_run_of_phase_7_stops_at_the_per_run_stop_with_the_rest_pending(
    paid: dict[str, Any], capsys: pytest.CaptureFixture[str]
) -> None:
    selected = unjudged(30)
    pieces = run.chunks(selected, repeats=3)
    paid["answer"] = costing(budget.SUBJECT_EXECUTION_USD)
    # Every case-run costs its whole USD 0.02: 6 in the early chunk, then 12 per chunk. The
    # declared USD 4.00 is the whole campaign, but an issue run may spend USD 1.00.
    assert await run.command_run(selected, 4.0, campaign=P7) == run.BLOCKED
    ran = [tuple(call["cases"]) for call in paid["promptfoo"]]
    # 0.12 + 3 x 0.24 = 0.84 is spent; the next chunk's 0.24 would pass the stop.
    assert ran == list(pieces[:4])
    assert "stopped: allowance" in capsys.readouterr().err
    summary = summary_of()
    assert summary["pass"] is False
    assert summary["pending"] == [case for piece in pieces[4:] for case in piece]
    (entry,) = ledger()
    assert entry["spent_usd"] == pytest.approx(0.84)
    assert (entry["campaign"], entry["stage"]) == ("07-ai-service", "issue")


async def test_the_phase_pr_run_is_not_bound_by_the_per_run_stop(paid: dict[str, Any]) -> None:
    selected = unjudged(30)
    paid["answer"] = costing(budget.SUBJECT_EXECUTION_USD)
    assert await run.command_run(selected, 4.0, campaign=P7, stage="phase-pr") in (0, 1)
    summary = summary_of()
    assert summary["pending"] == []
    (entry,) = ledger()
    assert entry["spent_usd"] == pytest.approx(90 * 0.02)
    assert entry["stage"] == "phase-pr"


async def test_issue_runs_cannot_spend_the_phase_pr_reserve(paid: dict[str, Any]) -> None:
    earlier = budget.open_allowance(4.0, run.LEDGER, P7, "issue")
    earlier.charge(1.0, "an earlier issue run")
    budget.record_run(run.LEDGER, "earlier-1", earlier, "partial")
    again = budget.open_allowance(4.0, run.LEDGER, P7, "issue")
    again.charge(0.5, "another issue run")
    budget.record_run(run.LEDGER, "earlier-2", again, "partial")
    with pytest.raises(budget.BudgetBlockedError, match="issue runs"):
        await run.command_run(["S01-en"], 4.0, campaign=P7)
    assert paid["api_starts"] == 0
    assert paid["promptfoo"] == []


async def test_the_spend_of_another_campaign_does_not_block_a_run(paid: dict[str, Any]) -> None:
    earlier = budget.open_allowance(13.0, run.LEDGER, P6, "issue")
    earlier.charge(13.0, "the whole phase-6 campaign")
    budget.record_run(run.LEDGER, "phase-6", earlier, "full")
    with pytest.raises(budget.BudgetBlockedError, match=r"06-llm-agent.*exhausted"):
        await run.command_run(["S01-en"], 1.0, campaign=P6)
    assert await run.command_run(["S01-en"], 1.0, campaign=P7) in (0, 1)


async def test_a_paid_run_reports_its_spend_line_before_and_after(
    paid: dict[str, Any], capsys: pytest.CaptureFixture[str]
) -> None:
    await run.command_run(["S01-en", "S01-cs"], 1.0, campaign=P7)
    expected = run.expected_usd(["S01-en", "S01-cs"], repeats=3)
    out = capsys.readouterr().out
    assert (
        f"spend: expected {expected:.4f} USD before the run;"
        " 4.0000 USD of the 07-ai-service ceiling (4.00 USD) remain"
    ) in out
    assert (
        f"spend: expected {expected:.4f} USD, actual 0.0060 USD (uncertain 0.0000);"
        " 3.9940 USD of the 07-ai-service ceiling (4.00 USD) remain"
    ) in out
    cost = summary_of()["cost"]
    assert cost["campaign"] == "07-ai-service"
    assert cost["stage"] == "issue"
    assert cost["ceiling_usd"] == 4.0
    assert cost["expected_usd"] == pytest.approx(expected)
    assert cost["campaign_remaining_usd"] == pytest.approx(3.994)
    (entry,) = ledger()
    assert entry["expected_usd"] == pytest.approx(expected, abs=1e-6)


# --- The loop's kept runs (issue #384, item 1) --------------------------------------------------


async def test_a_run_in_the_loop_counts_the_issue_spend_of_other_worktrees(
    paid: dict[str, Any], monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    kept = tmp_path / "eval-spend.json"
    runs = [
        {
            "key": f"{source}/r1",
            "source": source,
            "run": "r1",
            "campaign": "07-ai-service",
            "stage": "issue",
            "spentUsd": 1.0,
            "uncertainUsd": 0,
        }
        for source in ("feat-1-x", "feat-2-y")
    ]
    kept.write_text(json.dumps({"runs": runs}), encoding="utf-8")
    monkeypatch.setenv(budget.KEPT_RUNS_ENVIRONMENT, str(kept))
    with pytest.raises(budget.BudgetBlockedError, match="issue runs"):
        await run.command_run(["S01-en"], 4.0, campaign=P7)
    assert paid["api_starts"] == 0
    assert paid["promptfoo"] == []
    monkeypatch.delenv(budget.KEPT_RUNS_ENVIRONMENT)
    assert await run.command_run(["S01-en"], 4.0, campaign=P7) in (0, 1)
