"""The Main-model comparison: its fixed subset, candidates, option, scope and repeat count.

Fakes only: no model, no key, no API. The paid comparison itself is run by the owner.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from evals import budget, comparison, run
from evals.catalogue import BY_ID as CATALOGUE
from evals.datasets.cases import BY_ID as CASES
from evals.gate import evaluate_gate
from evals.graders import code, rubric
from llm_agent import versions
from llm_agent.models import config
from llm_agent.schemas.requests import ExecutionLimits
from tests.evals.records import SUBJECT, record

SUBSET = tuple(case.id for case in comparison.SUBSET)


@pytest.fixture(autouse=True)
def restore_the_main_stage() -> Iterator[None]:
    """A test may switch the Main stage like the runner does; the default comes back after it."""
    main = config.STAGES["main"]
    yield
    config.STAGES["main"] = main
    versions.cache_clear()


@pytest.fixture(autouse=True)
def fixed_prompt_fragments(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(code, "prompt_fragments", lambda: ("A fixed system prompt line.",))


# --- The subset -----------------------------------------------------------------------------


def test_the_subset_is_20_implemented_cases_10_per_language() -> None:
    assert len(SUBSET) == 20
    assert len(set(SUBSET)) == 20
    assert sum(CATALOGUE[case_id].language == "en" for case_id in SUBSET) == 10
    assert sum(CATALOGUE[case_id].language == "cs" for case_id in SUBSET) == 10
    for case_id in SUBSET:
        assert CATALOGUE[case_id].status == "implemented", case_id
        assert case_id in CASES, case_id


def test_every_subset_family_runs_in_both_languages_with_a_rationale() -> None:
    families: dict[str, set[str]] = {}
    for case in comparison.SUBSET:
        families.setdefault(CATALOGUE[case.id].family, set()).add(CATALOGUE[case.id].language)
        assert case.rationale.strip(), case.id
    assert all(languages == {"en", "cs"} for languages in families.values()), families


def test_the_subset_covers_factual_role_fit_and_hard_safety_cases() -> None:
    families = {CATALOGUE[case_id].family for case_id in SUBSET}
    # Factual answers from the database, role fit, unknown answers and invented facts, injection.
    assert {"Q01", "Q04"} <= families
    assert "Q15" in families
    assert {"S01", "S04", "S20"} <= families
    assert families & {"S15", "S16", "S18"}
    critical = [case_id for case_id in SUBSET if CATALOGUE[case_id].critical]
    assert 0 < len(critical) < len(SUBSET)


def test_the_subset_is_versioned() -> None:
    assert comparison.COMPARISON_VERSION.startswith("comparison-v")


def test_one_candidate_run_of_the_subset_stays_within_the_per_run_limit() -> None:
    # The owner's per-run limit of USD 1.00 (`packages/llm-agent/AGENTS.md`, Evals).
    assert run.reservation(SUBSET, repeats=1) <= 1.00


# --- The candidates -------------------------------------------------------------------------


def test_the_baseline_is_the_pinned_main_stage_and_security_is_not_a_candidate() -> None:
    assert comparison.BASELINE == "haiku-high"
    assert comparison.CANDIDATES["haiku-high"] == config.STAGES["main"]
    assert comparison.CANDIDATES["haiku-medium"].model == config.HAIKU
    assert comparison.CANDIDATES["haiku-medium"].effort == "medium"
    assert comparison.CANDIDATES["haiku-medium"].prices == config.HAIKU_PRICES
    assert set(comparison.CANDIDATES) == {"haiku-high", "haiku-medium", "sonnet-medium"}


def test_the_sonnet_candidate_reuses_the_judges_pinned_sonnet_prices() -> None:
    sonnet = comparison.CANDIDATES["sonnet-medium"]
    assert sonnet.model == rubric.JUDGE_MODEL
    assert sonnet.effort == "medium"
    assert rubric.JUDGE_PRICING_VERSION == config.PRICING_VERSION
    assert sonnet.prices == config.Prices(
        input=rubric.JUDGE_PRICE_INPUT,
        output=rubric.JUDGE_PRICE_OUTPUT,
        cache_read=rubric.JUDGE_PRICE_INPUT * 0.1,
        cache_write=rubric.JUDGE_PRICE_INPUT * 1.25,
    )


def test_a_candidate_whose_main_admission_exceeds_the_execution_allowance_is_blocked() -> None:
    limits = ExecutionLimits()
    assert comparison.admission_block("haiku-high") is None
    assert comparison.admission_block("haiku-medium") is None
    reason = comparison.admission_block("sonnet-medium")
    assert reason is not None
    assert f"{limits.max_cost_usd:.4f} USD" in reason
    assert "owner" in reason


def test_the_runner_blocks_that_candidate_before_anything_starts(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    async def never(*args: Any, **kwargs: Any) -> int:
        raise AssertionError("nothing may start")

    monkeypatch.setattr(run, "command_run", never)
    assert run.main(["--compare", "sonnet-medium", "--allowance", "1"]) == run.BLOCKED
    assert "blocked: sonnet-medium" in capsys.readouterr().err


# --- The option -----------------------------------------------------------------------------


def test_compare_runs_exactly_the_subset_with_the_named_candidate() -> None:
    chosen = run.plan(["--compare", "haiku-medium", "--allowance", "1"])
    assert chosen == run.Plan(
        mode="compare", cases=SUBSET, allowance_usd=1.0, candidate="haiku-medium"
    )


@pytest.mark.parametrize(
    ("argv", "message"),
    [
        (["--compare"], "--compare needs a value"),
        (["--compare", "--allowance", "1"], "--compare needs a value"),
        (["--compare", "gpt-high", "--allowance", "1"], "unknown candidate gpt-high"),
        (["--compare", "haiku-medium"], "a paid run needs --allowance"),
        (
            ["--compare", "haiku-medium", "--compare", "haiku-high", "--allowance", "1"],
            "--compare given twice",
        ),
        (
            ["--compare", "haiku-medium", "--case", "S01-en", "--allowance", "1"],
            "--compare runs the fixed subset",
        ),
        (["--compare", "haiku-medium", "--all", "--allowance", "1"], "--compare runs the fixed"),
        (["--compare", "haiku-medium", "--regrade", "x"], "--compare runs the fixed subset"),
        (
            ["--compare", "haiku-medium", "--judge", "--allowance", "1"],
            "--compare runs the fixed subset",
        ),
        (["--check-fixture", "--compare", "haiku-medium"], "--check-fixture takes no other"),
    ],
)
def test_invalid_compare_command_lines_stop_before_anything_starts(
    argv: list[str], message: str
) -> None:
    with pytest.raises(run.UsageError, match=message):
        run.plan(argv)


def test_ordinary_runs_name_no_candidate() -> None:
    assert run.plan(["--case", "S01-en", "--allowance", "1"]).candidate is None


# --- Repeats: one in comparison mode only ---------------------------------------------------


def test_comparison_mode_repeats_once_and_every_other_run_three_times() -> None:
    assert run.repeats_for(None) == 3
    assert run.repeats_for("haiku-medium") == 1


def test_the_reservation_follows_the_repeat_count() -> None:
    assert run.reservation(["Q01-en"]) == pytest.approx(
        3 * (budget.SUBJECT_EXECUTION_USD + run.JUDGE_CALL_RESERVATION_USD)
    )
    assert run.reservation(["Q01-en"], repeats=1) == pytest.approx(
        budget.SUBJECT_EXECUTION_USD + run.JUDGE_CALL_RESERVATION_USD
    )


def test_promptfoo_is_asked_for_the_runs_repeat_count(tmp_path: Path) -> None:
    def repeat(arguments: list[str]) -> str:
        return arguments[arguments.index("--repeat") + 1]

    assert repeat(run.promptfoo_arguments(tmp_path / "out.json")) == "3"
    assert repeat(run.promptfoo_arguments(tmp_path / "out.json", repeats=1)) == "1"


def test_every_missing_repeat_is_charged_at_its_whole_reservation() -> None:
    once = budget.Allowance(available_usd=1.0)
    run.charge_subject(once, [], ["S01-en"], repeats=1)
    assert once.uncertain_usd == pytest.approx(budget.SUBJECT_EXECUTION_USD)
    three = budget.Allowance(available_usd=1.0)
    run.charge_subject(three, [record("S01-en", repeat=1)], ["S01-en"])
    assert three.spent_usd == pytest.approx(0.001 + 2 * budget.SUBJECT_EXECUTION_USD)
    assert three.uncertain_usd == pytest.approx(2 * budget.SUBJECT_EXECUTION_USD)


async def test_one_repeat_is_complete_only_in_comparison_mode(tmp_path: Path) -> None:
    graded = [await run.grade_record(record("S01-en"), judge_model=None, allowance=None)]
    ordinary = run.write_summary(
        tmp_path / "run",
        mode="run",
        graded=graded,
        selected=["S01-en"],
        extra_failures=[],
        allowance=None,
        subject=SUBJECT,
    )
    assert "S01-en: 1 of 3 repeats ran" in ordinary["gate"]["failures"]
    compared = run.write_summary(
        tmp_path / "compare",
        mode="compare",
        graded=graded,
        selected=["S01-en"],
        extra_failures=[],
        allowance=None,
        subject=SUBJECT,
        candidate="haiku-medium",
    )
    assert not any("repeats ran" in failure for failure in compared["gate"]["failures"])


# --- Scope: a comparison, never a release pass ----------------------------------------------


async def test_a_comparison_is_never_full_and_never_a_pass(tmp_path: Path) -> None:
    graded = [await run.grade_record(record("S01-en"), judge_model=None, allowance=None)]
    assert graded[0].report["pass"]
    summary = run.write_summary(
        tmp_path,
        mode="compare",
        graded=graded,
        selected=["S01-en"],
        extra_failures=[],
        allowance=budget.Allowance(available_usd=1.0),
        subject=SUBJECT,
        candidate="haiku-medium",
    )
    assert summary["pass"] is False
    assert summary["gate"]["pass"] is False
    assert summary["gate"]["scope"] == "comparison"
    assert summary["comparison"]["release_pass"] is False
    stored = (tmp_path / "summary.json").read_text(encoding="utf-8")
    assert '"scope": "comparison"' in stored


def test_the_gate_of_the_whole_subset_is_not_full() -> None:
    gate = evaluate_gate([], SUBSET, repeats=1)
    assert gate.scope == "partial"


# --- The override reaches the agent and the summary -----------------------------------------


def test_switching_the_main_stage_changes_the_recorded_subject_versions() -> None:
    before = run.current_subject_versions()
    assert (before["main_model"], before["main_effort"]) == (config.HAIKU, "high")
    comparison.apply_main("haiku-medium")
    after = run.current_subject_versions()
    assert (after["main_model"], after["main_effort"]) == (config.HAIKU, "medium")
    assert after["security_model"] == before["security_model"]
    assert after["security_effort"] == "medium"
    assert config.STAGES["main"].prices == config.HAIKU_PRICES


def test_an_unknown_candidate_is_never_applied() -> None:
    with pytest.raises(ValueError, match="unknown candidate"):
        comparison.apply_main("gpt-high")
    assert config.STAGES["main"] == comparison.CANDIDATES["haiku-high"]


def test_the_provider_applies_the_candidate_named_in_its_environment() -> None:
    comparison.apply_from_environment({comparison.ENVIRONMENT: "haiku-medium"})
    assert versions().main_effort == "medium"


def test_without_a_named_candidate_the_provider_keeps_the_pinned_stage() -> None:
    comparison.apply_from_environment({})
    assert versions().main_effort == "high"


def test_promptfoo_receives_the_candidate_only_in_comparison_mode() -> None:
    values = run.promptfoo_values("u", ["S01-en"], None)
    assert values == {"LLM_AGENT_API_URL": "u", "LLM_AGENT_EVAL_CASES": "S01-en"}
    compared = run.promptfoo_values("u", ["S01-en", "Q01-cs"], "haiku-medium")
    assert compared[comparison.ENVIRONMENT] == "haiku-medium"
    assert compared["LLM_AGENT_EVAL_CASES"] == "S01-en,Q01-cs"


async def test_the_summary_records_the_candidate_and_its_figures_by_language(
    tmp_path: Path,
) -> None:
    comparison.apply_main("haiku-medium")
    subject = run.current_subject_versions()
    graded = []
    for case_id, latency in (("S01-en", 4000), ("S01-cs", 6000)):
        data = record(case_id)
        data["latency_ms"] = latency
        graded.append(await run.grade_record(data, judge_model=None, allowance=None))
    allowance = budget.Allowance(available_usd=1.0)
    allowance.charge(0.004, "subject")
    summary = run.write_summary(
        tmp_path,
        mode="compare",
        graded=graded,
        selected=["S01-en", "S01-cs"],
        extra_failures=[],
        allowance=allowance,
        subject=subject,
        candidate="haiku-medium",
    )
    assert summary["subject"]["main_effort"] == "medium"
    result = summary["comparison"]
    assert result["version"] == comparison.COMPARISON_VERSION
    assert result["candidate"] == "haiku-medium"
    assert result["baseline"] == "haiku-high"
    assert result["main"] == {"model": config.HAIKU, "effort": "medium"}
    assert result["security"] == {"model": config.HAIKU, "effort": "medium"}
    assert result["judge"] == {"model": rubric.JUDGE_MODEL, "effort": rubric.JUDGE_EFFORT}
    assert result["repeats"] == 1
    assert result["subset"] == list(SUBSET)
    for language in ("en", "cs"):
        figures = result["by_language"][language]
        assert figures["critical"] == {"passed": 1, "runs": 1, "rate": 1.0}
        assert set(figures) == {"useful", "citations", "false_blocking", "critical"}
    assert result["latency_ms"] == {"runs": 2, "p50": 4000, "p95": 6000}
    assert result["cost_usd"] == pytest.approx(0.004)


# --- The side-by-side report ----------------------------------------------------------------


def test_the_report_option_reads_comparison_folders_for_free() -> None:
    chosen = run.plan(["--compare-report", "a", "b"])
    assert chosen.mode == "compare-report"
    assert chosen.folders == (Path("a"), Path("b"))
    with pytest.raises(run.UsageError, match="--compare-report needs"):
        run.plan(["--compare-report"])
    with pytest.raises(run.UsageError, match="--compare-report takes no other option"):
        run.plan(["--compare-report", "a", "--allowance", "1"])


def _summary(candidate: str, effort: str, useful: int) -> dict[str, Any]:
    ratio = {"passed": useful, "runs": 4, "rate": useful / 4}
    figures = {"useful": ratio, "citations": ratio, "false_blocking": ratio, "critical": ratio}
    return {
        "mode": "compare",
        "comparison": {
            "version": comparison.COMPARISON_VERSION,
            "candidate": candidate,
            "main": {"model": config.HAIKU, "effort": effort},
            "by_language": {"en": figures, "cs": figures},
            "latency_ms": {"runs": 20, "p50": 4000, "p95": 9000},
            "cost_usd": 0.31,
        },
    }


def test_the_side_by_side_report_lists_every_candidate_with_its_figures() -> None:
    lines = comparison.side_by_side(
        [_summary("haiku-high", "high", 4), _summary("haiku-medium", "medium", 3)]
    )
    text = "\n".join(lines)
    assert "haiku-high" in text
    assert "haiku-medium" in text
    assert "3/4" in text
    assert "p50 4000" in text
    assert "0.3100" in text


def test_the_side_by_side_report_refuses_a_summary_that_is_no_comparison() -> None:
    with pytest.raises(ValueError, match="not a comparison"):
        comparison.side_by_side([{"mode": "run"}])
    other = _summary("haiku-high", "high", 4)
    other["comparison"]["version"] = "comparison-v0"
    with pytest.raises(ValueError, match="another comparison version"):
        comparison.side_by_side([other])
