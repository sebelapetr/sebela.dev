"""The runner's deterministic parts: planning, environment, records, scans, regrading and cost."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from evals import budget, run
from evals.datasets.cases import BY_ID
from evals.graders import code, rubric
from tests.evals.records import SUBJECT, record


@pytest.fixture(autouse=True)
def fixed_prompt_fragments(monkeypatch: pytest.MonkeyPatch) -> None:
    """The runner grades without the agent's real prompts; their leak check is tested apart."""
    monkeypatch.setattr(code, "prompt_fragments", lambda: ("A fixed system prompt line.",))


@pytest.mark.parametrize(
    ("argv", "message"),
    [
        (["--bogus"], "unknown option --bogus"),
        (["--case", "Q99-en", "--allowance", "1"], "unknown case Q99-en"),
        (["--case", "Q02-en", "--allowance", "1"], "Q02-en is pending and cannot run"),
        (["--case", "S01-en", "--case", "S01-en", "--allowance", "1"], "S01-en named twice"),
        (["--case", "S01-en"], "a paid run needs --allowance"),
        (["--case", "S01-en", "--allowance", "11"], "exceeds the 10.0 USD campaign ceiling"),
        (["--case"], "--case needs a value"),
        (["--regrade", "x", "--case", "S01-en"], "takes no --case or --all"),
        (["--regrade", "x", "--judge"], "--judge is paid and needs --allowance"),
        (["--regrade", "x", "--allowance", "1"], "--allowance applies only"),
        (["--judge", "--case", "S01-en", "--allowance", "1"], "--judge applies only to --regrade"),
        (["--check-fixture", "--case", "S01-en"], "--check-fixture takes no other option"),
        ([], "name the cases"),
    ],
)
def test_invalid_command_lines_stop_before_anything_starts(argv: list[str], message: str) -> None:
    with pytest.raises(run.UsageError, match=message):
        run.plan(argv)


def test_a_valid_paid_run_and_a_free_regrade() -> None:
    chosen = run.plan(["--case", "S01-en", "--case", "Q01-cs", "--allowance", "2.5"])
    assert chosen == run.Plan(mode="run", cases=("S01-en", "Q01-cs"), allowance_usd=2.5)
    assert run.plan(["--all", "--allowance", "1"]).cases[0] == "Q01-en"
    assert run.plan(["--regrade", "folder"]).judge is False
    assert run.plan(["--check-fixture"]).mode == "check-fixture"


def test_the_reservation_covers_every_subject_execution_and_judge_call() -> None:
    critical = run.reservation(["S01-en"])
    assert critical == pytest.approx(3 * budget.SUBJECT_EXECUTION_USD)
    ordinary = run.reservation(["Q01-en"])
    assert ordinary == pytest.approx(
        3 * budget.SUBJECT_EXECUTION_USD + 3 * run.JUDGE_CALL_RESERVATION_USD
    )


def test_promptfoo_sees_only_the_allowlisted_environment(tmp_path: Path) -> None:
    parent = {"PATH": "/bin", "ANTHROPIC_API_KEY": "k", "DATABASE_PASSWORD": "p", "API_PORT": "1"}
    env = run.promptfoo_environment(parent, {"LLM_AGENT_API_URL": "u"}, tmp_path)
    assert "DATABASE_PASSWORD" not in env
    assert "API_PORT" not in env
    assert env["LLM_AGENT_API_URL"] == "u"
    assert env["PROMPTFOO_DISABLE_TELEMETRY"] == "1"
    assert env["PROMPTFOO_CONFIG_DIR"] == str(tmp_path)


def test_records_are_numbered_by_repeat_and_missing_outputs_are_reported() -> None:
    report = {
        "results": {
            "results": [
                {
                    "vars": {"case_id": "S01-en"},
                    "response": {"output": json.dumps(record("S01-en"))},
                },
                {
                    "vars": {"case_id": "S01-en"},
                    "response": {"output": json.dumps(record("S01-en"))},
                },
                {"vars": {"case_id": "S01-en"}, "error": "timeout"},
            ]
        }
    }
    records, errors = run.records_from_report(report)
    assert [item["repeat"] for item in records] == [1, 2]
    assert errors == ["S01-en repeat 3: no record (timeout)"]


def test_the_credential_scan_reports_leaks_and_removes_everything(tmp_path: Path) -> None:
    raw = tmp_path / "raw.json"
    raw.write_text("contains sk-secret-value", encoding="utf-8")
    state = tmp_path / "state"
    (state / "logs").mkdir(parents=True)
    (state / "logs" / "log.txt").write_text("clean", encoding="utf-8")
    leaked = run.scan_and_remove([raw, state], ["sk-secret-value"])
    assert leaked == [raw]
    assert not raw.exists()
    assert not state.exists()


def test_only_long_secret_values_are_scanned() -> None:
    assert run.secrets_of({"ANTHROPIC_API_KEY": "x" * 20, "DATABASE_PASSWORD": "short"}) == [
        "x" * 20
    ]


def test_a_record_of_another_dataset_or_agent_version_is_not_regraded() -> None:
    data = record("S01-en")
    assert run.compatible_record(data, SUBJECT) is None
    assert run.compatible_record(data, {"pipeline": "other"}) == "another agent version"
    data["fingerprint"]["dataset_version"] = "profile-v1-000000000000"
    assert str(run.compatible_record(data, SUBJECT)).startswith("dataset ")


@pytest.mark.parametrize(
    ("usage", "expected"),
    [
        ({"cost_usd": 0.004, "cost_uncertain": False}, (0.004, False)),
        ({"cost_usd": 0.004, "cost_uncertain": True}, (budget.SUBJECT_EXECUTION_USD, True)),
        (None, (budget.SUBJECT_EXECUTION_USD, True)),
    ],
)
def test_unmeasured_subject_cost_consumes_the_whole_reservation(
    usage: dict[str, Any] | None, expected: tuple[float, bool]
) -> None:
    data = record("S01-en")
    data["result"]["usage"] = usage
    assert run.subject_cost(data) == expected


async def test_a_free_regrade_leaves_an_unjudged_ordinary_run_ungraded() -> None:
    graded = await run.grade_record(record("Q01-en"), judge_model=None, allowance=None)
    assert graded.run.ungraded
    assert not graded.report["pass"]


async def test_a_compatible_stored_judgement_is_reused_without_a_call() -> None:
    data = record("Q01-en")
    case = BY_ID["Q01-en"]
    data["judgement"] = {
        "rubric_version": rubric.RUBRIC_VERSION,
        "judge_model": rubric.JUDGE_MODEL,
        "judge_effort": rubric.JUDGE_EFFORT,
        "input_hash": rubric.input_hash(rubric.judge_input(case, data)),
        "verdict": {
            "relevant": True,
            "language_correct": True,
            "claims": [{"claim": "Engineer.", "support": "supported"}],
            "cited_sources": [{"ref": "src-1", "supports": True}],
            "note": "",
        },
    }
    graded = await run.grade_record(data, judge_model=None, allowance=None)
    assert graded.report["pass"], graded.report["failures"]
    assert graded.run.useful is True
    assert (graded.run.cited, graded.run.supported_cited) == (1, 1)


async def test_a_paid_judgement_is_reserved_first_and_blocks_over_the_allowance() -> None:
    class NeverCalled:
        async def ainvoke(self, input: Any) -> Any:
            raise AssertionError("the judge must not be called")

    with pytest.raises(budget.BudgetBlockedError):
        await run.grade_record(
            record("Q01-en"), judge_model=NeverCalled(), allowance=budget.Allowance(0.0001)
        )


def test_check_fixture_person_detects_a_different_contact() -> None:
    from evals.datasets.cases import FIXTURE_PERSON

    assert run.check_fixture_person(FIXTURE_PERSON) == []
    assert run.check_fixture_person({**FIXTURE_PERSON, "email": "other@x.test"}) == [
        "person.email differs from the fixture"
    ]


async def test_the_summary_reports_latency_percentiles_and_no_answer_text(tmp_path: Path) -> None:
    graded = []
    for repeat, latency in enumerate([4000, 5000, 6000, 9000], start=1):
        data = record("S01-en", repeat=repeat)
        data["latency_ms"] = latency
        graded.append(await run.grade_record(data, judge_model=None, allowance=None))
    summary = run.write_summary(
        tmp_path,
        mode="regrade",
        graded=graded,
        selected=["S01-en"],
        extra_failures=[],
        allowance=None,
        subject=SUBJECT,
    )
    # Nearest-rank percentiles over the case-runs that measured a latency.
    assert summary["latency_ms"] == {"runs": 4, "p50": 5000, "p95": 9000}
    stored = (tmp_path / "summary.json").read_text(encoding="utf-8")
    assert "fictional engineer" not in stored


def test_latency_percentiles_without_measurements_are_empty() -> None:
    assert run.latency_percentiles([None, None]) == {"runs": 0, "p50": None, "p95": None}
