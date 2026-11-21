"""The paid-run controls of `command_run`, driven with fakes only (no model, no key, no API).

Runs that never started are not charged; a run is split into an early chunk and the rest, and an
anomaly in the early chunk stops it with the remaining cases pending; judging goes through one
batch per chunk (or the direct debugging path).
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

from evals import judging, run
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


@pytest.fixture
def paid(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> dict[str, Any]:
    """`command_run` with a fake test API, Promptfoo and batch client.

    `seen["answer"]` builds the record of one case-run; the fake Promptfoo answers exactly the
    cases its environment names, `repeats` times each, like the provider does.
    """
    batches = AnsweringBatches()
    seen: dict[str, Any] = {
        "promptfoo": [],
        "answer": lambda case_id, repeat: record(case_id, repeat=repeat),
        "batches": batches,
        "person": {"name": "fixed"},
    }
    monkeypatch.setenv("ANTHROPIC_API_KEY", "fake-key-never-used-0000")
    monkeypatch.setattr(run, "REPORT_ROOT", tmp_path / "reports")
    monkeypatch.setattr(run, "LEDGER", tmp_path / "reports" / "ledger.json")

    @contextlib.asynccontextmanager
    async def api(scratch: Path) -> AsyncIterator[Any]:
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
    assert await run.command_run(["S01-en", "S01-cs"], 1.0) == run.BLOCKED
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
    assert await run.command_run(["S01-en"], 1.0) in (0, 1)
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
    await run.command_run(selected, 1.0)
    assert [call["cases"] for call in paid["promptfoo"]] == [
        ["S01-en", "S01-cs"],
        ["S02-en", "S02-cs", "S03-en"],
    ]
    summary = summary_of()
    assert summary["pending"] == []
    assert summary["stopped"] is None
    assert len(summary["case_runs"]) == 15


async def test_a_comparison_starts_with_six_cases_at_one_repeat(paid: dict[str, Any]) -> None:
    assert run.first_chunk(["a", "b", "c", "d", "e", "f", "g"], repeats=1) == (
        ("a", "b", "c", "d", "e", "f"),
        ("g",),
    )
    assert run.first_chunk(["a", "b"], repeats=3) == (("a", "b"),)
    assert run.first_chunk(["a", "b", "c"], repeats=3) == (("a", "b"), ("c",))


async def test_two_stopped_case_runs_in_the_early_chunk_stop_the_run_with_the_rest_pending(
    paid: dict[str, Any], capsys: pytest.CaptureFixture[str]
) -> None:
    def answer(case_id: str, repeat: int) -> dict[str, Any]:
        outcome = "limit_reached" if case_id == "S01-cs" else "answered"
        return record(case_id, repeat=repeat, outcome=outcome)

    paid["answer"] = answer
    selected = ["S01-en", "S01-cs", "S02-en", "S02-cs"]
    assert await run.command_run(selected, 1.0) == run.BLOCKED
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
    assert await run.command_run(["S01-en", "S01-cs", "S02-en"], 1.0) == run.BLOCKED
    assert len(paid["promptfoo"]) == 1
    summary = summary_of()
    assert "uncertain cost" in summary["stopped"]
    assert summary["pending"] == ["S02-en"]


async def test_a_single_chunk_run_needs_no_anomaly_stop(paid: dict[str, Any]) -> None:
    paid["answer"] = lambda case_id, repeat: record(case_id, repeat=repeat, outcome="limit_reached")
    assert await run.command_run(["S01-en", "S01-cs"], 1.0) == 1
    summary = summary_of()
    assert summary["stopped"] is None
    assert summary["pending"] == []


# --- O1: judging through one batch per chunk ------------------------------------------------


async def test_a_judged_run_judges_each_chunk_in_one_batch(paid: dict[str, Any]) -> None:
    await run.command_run(["Q01-en", "Q01-cs", "Q02-en"], 1.0)
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
    assert await run.command_run(["Q01-en", "Q01-cs", "Q02-en"], 1.0) == run.BLOCKED
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
    await run.command_run(["Q01-en"], 1.0, judge_mode="direct")
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
    assert await run.command_regrade(source, judge=True, declared_usd=1.0) == run.BLOCKED
    batches: AnsweringBatches = paid["batches"]
    assert [len(sent) for sent in batches.created] == [6]
    summary = summary_of()
    assert summary["stopped"] == "1 judge request(s) failed"
    assert summary["pending"] == ["Q02-en"]
