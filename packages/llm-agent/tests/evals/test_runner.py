"""The runner's deterministic parts: planning, environment, records, scans, regrading and cost."""

from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest

from evals import budget, catalogue, gate, run
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
        (["--case", "S01-en", "--case", "S01-en", "--allowance", "1"], "S01-en named twice"),
        (["--case", "S01-en"], "a paid run needs --allowance"),
        (
            ["--case", "S01-en", "--allowance", "14"],
            "exceeds the 13.00 USD ceiling of the 06-llm-agent",
        ),
        (["--case", "S01-en", "--allowance", "1", "--campaign"], "--campaign needs a value"),
        (
            ["--case", "S01-en", "--allowance", "1", "--campaign", "07-ai-service"],
            "differs from SEBELA_EVAL_CAMPAIGN",
        ),
        (["--case", "S01-en", "--allowance", "1", "--stage"], "--stage needs a value"),
        (
            ["--case", "S01-en", "--allowance", "1", "--stage", "full"],
            "--stage is issue or phase-pr",
        ),
        (["--regrade", "x", "--stage", "phase-pr"], "--stage applies only"),
        (["--regrade", "x", "--campaign", "06-llm-agent"], "--campaign applies only"),
        (
            ["--check-fixture", "--campaign", "06-llm-agent"],
            "--check-fixture takes no other option",
        ),
        (["--case"], "--case needs a value"),
        (["--regrade", "x", "--case", "S01-en"], "takes no --case or --all"),
        (["--regrade", "x", "--judge"], "--judge is paid and needs --allowance"),
        (["--regrade", "x", "--allowance", "1"], "--allowance applies only"),
        (["--judge", "--case", "S01-en", "--allowance", "1"], "--judge applies only to --regrade"),
        (["--check-fixture", "--case", "S01-en"], "--check-fixture takes no other option"),
        (["--check-fixture", "--judge-mode", "direct"], "--check-fixture takes no other option"),
        (["--regrade", "x", "--judge-mode", "direct"], "--judge-mode applies only"),
        (["--case", "S01-en", "--allowance", "1", "--judge-mode", "cheap"], "batch or direct"),
        (["--case", "S01-en", "--allowance", "1", "--deadline-minutes"], "needs a value"),
        (["--case", "S01-en", "--allowance", "1", "--deadline-minutes", "0"], "positive number"),
        (["--case", "S01-en", "--allowance", "1", "--deadline-minutes", "abc"], "positive number"),
        (["--case", "S01-en", "--allowance", "1", "--deadline-minutes", "nan"], "positive number"),
        (
            ["--case", "S01-en", "--allowance", "1"] + ["--deadline-minutes", "5"] * 2,
            "--deadline-minutes given twice",
        ),
        (["--regrade", "x", "--deadline-minutes", "5"], "--deadline-minutes applies only"),
        (["--check-fixture", "--deadline-minutes", "5"], "--check-fixture takes no other option"),
        (["--case", "S01-en", "--allowance", "1", "--judge-mode"], "--judge-mode needs a value"),
        (
            [
                "--case",
                "S01-en",
                "--allowance",
                "1",
                "--judge-mode",
                "batch",
                "--judge-mode",
                "direct",
            ],
            "--judge-mode given twice",
        ),
        ([], "name the cases"),
    ],
)
def test_invalid_command_lines_stop_before_anything_starts(argv: list[str], message: str) -> None:
    with pytest.raises(run.UsageError, match=message):
        run.plan(argv)


def test_a_pending_case_cannot_run(monkeypatch: pytest.MonkeyPatch) -> None:
    # `evals.run` reads the catalogue's own mapping, so the case turns pending for the runner.
    pending = replace(catalogue.BY_ID["Q19-en"], status="pending")
    monkeypatch.setitem(catalogue.BY_ID, "Q19-en", pending)
    with pytest.raises(run.UsageError, match="Q19-en is pending and cannot run"):
        run.plan(["--case", "Q19-en", "--allowance", "1"])


def test_a_valid_paid_run_and_a_free_regrade() -> None:
    chosen = run.plan(["--case", "S01-en", "--case", "Q01-cs", "--allowance", "2.5"])
    assert chosen == run.Plan(
        mode="run",
        cases=("S01-en", "Q01-cs"),
        allowance_usd=2.5,
        campaign=budget.campaign("06-llm-agent"),
        stage="issue",
    )
    assert run.plan(["--all", "--allowance", "1"]).cases[0] == "Q01-en"
    assert run.plan(["--regrade", "folder"]).judge is False
    assert run.plan(["--check-fixture"]).mode == "check-fixture"


@pytest.mark.parametrize(
    "argv",
    [
        ["--case", "S01-en", "--allowance", "1"],
        ["--all", "--allowance", "1"],
        ["--regrade", "x", "--judge", "--allowance", "1"],
        ["--compare", "haiku-medium", "--case", "Q01-en", "--allowance", "1"],
    ],
)
def test_a_paid_command_that_names_no_campaign_is_refused(
    argv: list[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv(budget.CAMPAIGN_ENVIRONMENT)
    with pytest.raises(run.UsageError, match="names no campaign"):
        run.plan(argv)
    with pytest.raises(run.UsageError, match="unknown campaign 09-rag"):
        run.plan([*argv, "--campaign", "09-rag"])
    # Free commands need none.
    assert run.plan(["--regrade", "folder"]).campaign is None
    assert run.plan(["--check-fixture"]).campaign is None


def test_a_paid_command_names_its_campaign_and_stage(monkeypatch: pytest.MonkeyPatch) -> None:
    paid = ["--case", "S01-en", "--allowance", "1"]
    monkeypatch.setenv(budget.CAMPAIGN_ENVIRONMENT, "07-ai-service")
    assert run.plan(paid).campaign == budget.campaign("07-ai-service")
    assert run.plan(paid).stage == "issue"
    assert run.plan([*paid, "--stage", "phase-pr"]).stage == "phase-pr"
    monkeypatch.delenv(budget.CAMPAIGN_ENVIRONMENT)
    named = run.plan([*paid, "--campaign", "08-mcp-public"])
    assert named.campaign == budget.campaign("08-mcp-public")
    # The allowance is checked against the named campaign's ceiling, not a larger one.
    with pytest.raises(run.UsageError, match=r"2\.30 USD ceiling of the 08-mcp-public"):
        run.plan(["--case", "S01-en", "--allowance", "4", "--campaign", "08-mcp-public"])
    with pytest.raises(run.UsageError, match=r"4\.00 USD ceiling of the 07-ai-service"):
        run.plan(["--case", "S01-en", "--campaign", "07-ai-service", "--allowance", "10"])


def test_the_expected_cost_of_the_full_run_matches_the_documented_estimate() -> None:
    every = [case.id for case in catalogue.implemented()]
    assert run.expected_usd(every, repeats=3) == pytest.approx(1.22, abs=0.02)
    assert run.expected_usd(every, repeats=3, judge_mode="direct") == pytest.approx(2.00, abs=0.03)


def test_a_paid_run_has_an_overall_deadline_that_can_be_set() -> None:
    assert run.DEADLINE_MINUTES == 150
    paid = ["--case", "S01-en", "--allowance", "1"]
    assert run.plan(paid).deadline_minutes == run.DEADLINE_MINUTES
    assert run.plan([*paid, "--deadline-minutes", "30"]).deadline_minutes == 30
    judged = ["--regrade", "x", "--judge", "--allowance", "1", "--deadline-minutes", "5.5"]
    assert run.plan(judged).deadline_minutes == 5.5


def test_the_judge_runs_as_a_batch_unless_direct_mode_is_asked_for() -> None:
    assert run.plan(["--case", "Q01-en", "--allowance", "1"]).judge_mode == "batch"
    direct = ["--case", "Q01-en", "--allowance", "1", "--judge-mode", "direct"]
    assert run.plan(direct).judge_mode == "direct"
    regrade = ["--regrade", "x", "--judge", "--allowance", "1", "--judge-mode", "direct"]
    assert run.plan(regrade).judge_mode == "direct"
    compare = ["--compare", "haiku-medium", "--allowance", "1", "--judge-mode", "direct"]
    assert run.plan(compare).judge_mode == "direct"


def test_a_judge_call_is_reserved_with_a_one_hour_cache_write_and_the_full_output() -> None:
    direct = (
        8_000 * rubric.JUDGE_PRICE_INPUT * rubric.JUDGE_CACHE_WRITE_1H
        + rubric.JUDGE_MAX_TOKENS * rubric.JUDGE_PRICE_OUTPUT
    ) / 1_000_000
    assert pytest.approx(direct) == run.JUDGE_DIRECT_CALL_RESERVATION_USD
    # The default batch mode: the same upper bound at the batch discount.
    assert pytest.approx(direct * rubric.JUDGE_BATCH_DISCOUNT) == run.JUDGE_CALL_RESERVATION_USD
    assert run.judge_call_reservation_usd("batch") == run.JUDGE_CALL_RESERVATION_USD
    assert run.judge_call_reservation_usd("direct") == run.JUDGE_DIRECT_CALL_RESERVATION_USD


def test_the_direct_judge_mode_reserves_the_undiscounted_judge_calls() -> None:
    assert run.reservation(["Q01-en"], judge_mode="direct") == pytest.approx(
        3 * budget.SUBJECT_EXECUTION_USD + 3 * run.JUDGE_DIRECT_CALL_RESERVATION_USD
    )


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
    assert gate.latency_percentiles([None, None]) == {"runs": 0, "p50": None, "p95": None}
