"""The Main-model comparison: its fixed subset, candidates, option, scope and repeat count.

Fakes only: no model, no key, no API. The paid comparison itself is run by the owner.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
from collections.abc import AsyncIterator, Iterator, Mapping
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from pydantic import ValidationError

from evals import budget, comparison, provider, run
from evals.catalogue import BY_ID as CATALOGUE
from evals.comparison import ComparisonLimits
from evals.datasets.cases import BY_ID as CASES
from evals.gate import evaluate_gate
from evals.graders import code, rubric
from llm_agent import versions
from llm_agent.models import config
from llm_agent.models.usage import MeasuredUsage
from llm_agent.reliability.budgets import Budget
from llm_agent.reliability.stops import LimitReached
from llm_agent.schemas.requests import ExecutionLimits
from tests.evals.records import SUBJECT, record

P6 = budget.campaign("06-llm-agent")
SUBSET = tuple(case.id for case in comparison.SUBSET)


def honest_unknown(case_id: str) -> dict[str, Any]:
    """A passing S01 case-run: no salary is stored, so an honest unknown with the contact card."""
    czech = case_id.endswith("-cs")
    return record(
        case_id,
        outcome="insufficient_evidence",
        language="cs" if czech else "en",
        text="Mzda zveřejněná není, zeptejte se jí přímo."
        if czech
        else "Her public profile does not state a salary expectation. Please ask her directly.",
        cite=False,
        kinds=("contact",),
        contact=True,
    )


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


# --- The candidates -------------------------------------------------------------------------


def test_the_baseline_is_the_pinned_main_stage_and_security_is_not_a_candidate() -> None:
    # Owner decision on #183 (2026-11-21): the Main default is Haiku 5.5 at medium effort.
    assert comparison.BASELINE == "haiku-medium"
    assert comparison.CANDIDATES["haiku-medium"] == config.STAGES["main"]
    assert comparison.CANDIDATES["haiku-high"].model == config.HAIKU
    assert comparison.CANDIDATES["haiku-high"].effort == "high"
    assert comparison.CANDIDATES["haiku-high"].prices == config.HAIKU_PRICES
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


# --- The option -----------------------------------------------------------------------------


def test_compare_runs_exactly_the_subset_with_the_named_candidate() -> None:
    chosen = run.plan(["--compare", "haiku-medium", "--allowance", "1"])
    assert chosen == run.Plan(
        mode="compare",
        cases=SUBSET,
        allowance_usd=1.0,
        candidate="haiku-medium",
        campaign=P6,
        stage="issue",
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
            ["--compare", "haiku-medium", "--case", "Q02-en", "--allowance", "1"],
            "Q02-en is not in the comparison subset",
        ),
        (
            [
                "--compare",
                "haiku-medium",
                "--case",
                "S01-en",
                "--case",
                "S01-en",
                "--allowance",
                "1",
            ],
            "S01-en named twice",
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
    graded = [await run.grade_record(honest_unknown("S01-en"), judge_model=None, allowance=None)]
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
    graded = [await run.grade_record(honest_unknown("S01-en"), judge_model=None, allowance=None)]
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
    assert (before["main_model"], before["main_effort"]) == (config.HAIKU, "medium")
    comparison.apply_main("haiku-high")
    after = run.current_subject_versions()
    assert (after["main_model"], after["main_effort"]) == (config.HAIKU, "high")
    assert after["security_model"] == before["security_model"]
    assert after["security_effort"] == "medium"
    assert config.STAGES["main"].prices == config.HAIKU_PRICES


def test_an_unknown_candidate_is_never_applied() -> None:
    with pytest.raises(ValueError, match="unknown candidate"):
        comparison.apply_main("gpt-high")
    assert config.STAGES["main"] == comparison.CANDIDATES["haiku-medium"]


def test_the_provider_applies_the_candidate_named_in_its_environment() -> None:
    comparison.apply_from_environment({comparison.ENVIRONMENT: "haiku-high"})
    assert versions().main_effort == "high"


def test_without_a_named_candidate_the_provider_keeps_the_pinned_stage() -> None:
    comparison.apply_from_environment({})
    assert versions().main_effort == "medium"


def test_promptfoo_receives_the_candidate_only_in_comparison_mode() -> None:
    values = run.promptfoo_values("u", ["S01-en"], None)
    assert values == {"LLM_AGENT_API_URL": "u", "LLM_AGENT_EVAL_CASES": "S01-en"}
    compared = run.promptfoo_values("u", ["S01-en", "Q01-cs"], "haiku-medium")
    assert compared[comparison.ENVIRONMENT] == "haiku-medium"
    assert compared["LLM_AGENT_EVAL_CASES"] == "S01-en,Q01-cs"


async def test_the_summary_records_the_candidate_and_its_figures_by_language(
    tmp_path: Path,
) -> None:
    comparison.apply_main("haiku-high")
    subject = run.current_subject_versions()
    graded = []
    for case_id, latency in (("S01-en", 4000), ("S01-cs", 6000)):
        data = honest_unknown(case_id)
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
        candidate="haiku-high",
    )
    assert summary["subject"]["main_effort"] == "high"
    result = summary["comparison"]
    assert result["version"] == comparison.COMPARISON_VERSION
    assert result["candidate"] == "haiku-high"
    assert result["baseline"] == "haiku-medium"
    assert result["main"] == {"model": config.HAIKU, "effort": "high"}
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


def test_compare_may_run_a_slice_of_the_subset_named_with_case() -> None:
    chosen = run.plan(
        ["--compare", "sonnet-medium", "--case", "Q01-en", "--case", "Q01-cs", "--allowance", "1"]
    )
    assert chosen == run.Plan(
        mode="compare",
        cases=("Q01-en", "Q01-cs"),
        allowance_usd=1.0,
        candidate="sonnet-medium",
        campaign=P6,
        stage="issue",
    )


# --- The comparison-only execution limit ----------------------------------------------------


def _worst_case(prices: config.Prices) -> float:
    """Security at its caps plus every allowed Main decision at the per-call caps, the Main
    input bounded by the execution's input cap and the Main output by its output cap."""
    limits = ExecutionLimits()
    security = config.STAGES["security"].prices
    main_input = min(
        limits.main_decisions * limits.main_input_tokens,
        limits.max_input_tokens - limits.security_input_tokens,
    )
    main_output = min(limits.main_decisions * limits.main_output_tokens, limits.max_output_tokens)
    main = main_input * prices.input + main_output * prices.output
    guard = (
        limits.security_input_tokens * security.input
        + limits.security_output_tokens * security.output
    )
    return (main + guard) / 1_000_000


def test_the_public_execution_limits_are_unchanged() -> None:
    assert ExecutionLimits().max_cost_usd == 0.02
    assert budget.SUBJECT_EXECUTION_USD == 0.02
    with pytest.raises(ValidationError):
        ExecutionLimits(max_cost_usd=0.03)
    with pytest.raises(ValidationError):
        ExecutionLimits.model_validate({"max_cost_usd": 0.12})


def test_the_haiku_candidates_keep_the_default_limits() -> None:
    assert comparison.execution_limits("haiku-high") == ExecutionLimits()
    assert comparison.execution_limits("haiku-medium") == ExecutionLimits()
    assert _worst_case(config.HAIKU_PRICES) < ExecutionLimits().max_cost_usd


def test_the_sonnet_limit_is_derived_from_its_pinned_prices_and_the_caps() -> None:
    limits = comparison.execution_limits("sonnet-medium")
    sonnet = comparison.CANDIDATES["sonnet-medium"].prices
    # Three Main decisions (48,000 input tokens, 16,384 output tokens across them) at Sonnet's
    # prices plus one Security call.
    assert limits.max_cost_usd == pytest.approx(_worst_case(sonnet))
    assert limits.max_cost_usd == pytest.approx((48_000 * 2.0 + 16_384 * 10.0) / 1e6 + 0.000784)
    assert isinstance(limits, ExecutionLimits)
    assert limits.model_dump(exclude={"max_cost_usd"}) == ExecutionLimits().model_dump(
        exclude={"max_cost_usd"}
    )


def _tool_using_answer(limits: ExecutionLimits, *, tool_tokens: int, output: int) -> int:
    """Drives the real Budget through Security and every Main decision of a tool-using answer,
    each tool result growing the next decision's input; returns the admitted decisions."""
    sonnet = comparison.CANDIDATES["sonnet-medium"].prices
    haiku = config.STAGES["security"].prices
    allowance = Budget(limits)
    guard = allowance.admit(input_tokens=1200, input_cap=4000, output_cap=768, prices=haiku)
    allowance.settle(guard, MeasuredUsage(input_tokens=1200, output_tokens=80))
    context = 3000
    admitted = 0
    for _ in range(limits.main_decisions):
        decision = allowance.admit(
            input_tokens=context, input_cap=limits.main_input_tokens, output_cap=8192, prices=sonnet
        )
        allowance.settle(decision, MeasuredUsage(input_tokens=context, output_tokens=output))
        admitted += 1
        context = min(context + output + tool_tokens, limits.main_input_tokens)
    return admitted


def test_the_sonnet_limit_admits_every_main_decision_of_a_tool_using_answer() -> None:
    limits = comparison.execution_limits("sonnet-medium")
    assert _tool_using_answer(limits, tool_tokens=3000, output=300) == limits.main_decisions == 3
    # Tool results that fill the Main context up to its cap still fit.
    assert _tool_using_answer(limits, tool_tokens=5000, output=600) == 3


def test_a_limit_for_one_main_call_refuses_the_second_decision() -> None:
    one_call = ComparisonLimits(max_cost_usd=(16_000 * 2.0 + 8_192 * 10.0) / 1e6 + 0.000784)
    with pytest.raises(LimitReached) as stopped:
        _tool_using_answer(one_call, tool_tokens=3000, output=300)
    assert stopped.value.reason == "cost_allowance"


def test_the_sonnet_limit_never_stops_a_main_decision_on_cost_at_the_full_caps() -> None:
    # Every attempt at its input cap and its whole admitted output: the token caps stop the
    # execution before the cost allowance does.
    limits = comparison.execution_limits("sonnet-medium")
    sonnet = comparison.CANDIDATES["sonnet-medium"].prices
    haiku = config.STAGES["security"].prices
    allowance = Budget(limits)
    guard = allowance.admit(input_tokens=4000, input_cap=4000, output_cap=768, prices=haiku)
    allowance.settle(guard, MeasuredUsage(input_tokens=4000, output_tokens=guard.max_tokens))

    def decide() -> None:
        decision = allowance.admit(
            input_tokens=16_000, input_cap=16_000, output_cap=8192, prices=sonnet
        )
        allowance.settle(
            decision, MeasuredUsage(input_tokens=16_000, output_tokens=decision.max_tokens)
        )

    decide()
    decide()
    assert limits.main_decisions == 3
    with pytest.raises(LimitReached) as stopped:
        decide()
    assert stopped.value.reason == "output_tokens"


def test_the_whole_sonnet_subset_is_refused_above_the_per_run_limit() -> None:
    usd = run.reservation(
        SUBSET, repeats=1, execution_usd=comparison.execution_limits("sonnet-medium").max_cost_usd
    )
    assert usd > comparison.PER_RUN_LIMIT_USD
    with pytest.raises(run.UsageError, match=r"above the USD 1\.00 per-run limit") as refused:
        run.plan(["--compare", "sonnet-medium", "--allowance", "6"])
    for piece in run.suggested_slices("sonnet-medium"):
        assert " ".join(f"--case {case_id}" for case_id in piece) in str(refused.value)


def test_the_suggested_sonnet_slices_cover_the_subset_within_the_per_run_limit() -> None:
    pieces = run.suggested_slices("sonnet-medium")
    assert tuple(case_id for piece in pieces for case_id in piece) == SUBSET
    usd = comparison.execution_limits("sonnet-medium").max_cost_usd
    for piece in pieces:
        assert run.reservation(piece, repeats=1, execution_usd=usd) <= 1.00
        args = ["--compare", "sonnet-medium", "--allowance", "1"]
        for case_id in piece:
            args += ["--case", case_id]
        assert run.plan(args).cases == piece
    assert len(pieces) == 7


def test_a_haiku_subset_needs_no_slices() -> None:
    assert run.suggested_slices("haiku-high") == (SUBSET,)
    assert run.suggested_slices("haiku-medium") == (SUBSET,)


def test_a_sonnet_slice_runs(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: dict[str, Any] = {}

    async def fake(
        selected: Any,
        declared: float,
        *,
        campaign: budget.Campaign,
        stage: str = "",
        candidate: str | None = None,
        judge_mode: str = "",
        deadline_minutes: float = 0.0,
    ) -> int:
        seen.update(
            selected=tuple(selected),
            declared=declared,
            campaign=campaign.name,
            stage=stage,
            candidate=candidate,
            judge_mode=judge_mode,
            deadline_minutes=deadline_minutes,
        )
        return 0

    monkeypatch.setattr(run, "command_run", fake)
    piece = run.suggested_slices("sonnet-medium")[0]
    args = ["--compare", "sonnet-medium", "--allowance", "1"]
    for case_id in piece:
        args += ["--case", case_id]
    assert run.main(args) == 0
    assert seen == {
        "selected": piece,
        "declared": 1.0,
        "campaign": "06-llm-agent",
        "stage": "issue",
        "candidate": "sonnet-medium",
        "judge_mode": "batch",
        "deadline_minutes": run.DEADLINE_MINUTES,
    }
    assert run.main(["--compare", "sonnet-medium", "--allowance", "6"]) == run.BLOCKED


def test_the_provider_gets_the_candidates_limits_and_none_otherwise() -> None:
    limits = comparison.apply_from_environment({comparison.ENVIRONMENT: "sonnet-medium"})
    assert limits == comparison.execution_limits("sonnet-medium")
    assert comparison.apply_from_environment({}) is None


async def test_the_provider_runs_the_agent_with_the_candidates_limits(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import llm_agent

    seen: list[ExecutionLimits | None] = []

    class Stop(Exception):
        pass

    class Reader:
        def __init__(self, url: str) -> None:
            pass

        async def __aenter__(self) -> Reader:
            return self

        async def __aexit__(self, *args: object) -> None:
            return None

    class Agent:
        def __init__(self, **kwargs: Any) -> None:
            pass

        async def run(self, request: Any, *, limits: ExecutionLimits | None = None) -> Any:
            seen.append(limits)
            raise Stop

    monkeypatch.setattr(llm_agent, "ApiContentReader", Reader)
    monkeypatch.setattr(llm_agent, "ChatAgent", Agent)
    monkeypatch.setattr(llm_agent, "anthropic_model_factory", lambda: None)
    monkeypatch.setenv("LLM_AGENT_API_URL", "http://fake.invalid")
    context = {"vars": {"case_id": "S01-en"}}
    monkeypatch.setenv(comparison.ENVIRONMENT, "sonnet-medium")
    with pytest.raises(Stop):
        await provider.call_api("", {}, context)
    monkeypatch.delenv(comparison.ENVIRONMENT)
    with pytest.raises(Stop):
        await provider.call_api("", {}, context)
    assert seen == [comparison.execution_limits("sonnet-medium"), None]


def test_the_reservation_uses_the_candidates_execution_limit() -> None:
    sonnet = comparison.execution_limits("sonnet-medium").max_cost_usd
    assert run.reservation(["S01-en"], repeats=1, execution_usd=sonnet) == pytest.approx(sonnet)
    assert run.reservation(["Q01-en"], repeats=1, execution_usd=sonnet) == pytest.approx(
        sonnet + run.JUDGE_CALL_RESERVATION_USD
    )
    assert run.reservation(["S01-en"]) == pytest.approx(3 * budget.SUBJECT_EXECUTION_USD)


def test_a_missing_or_unmeasured_comparison_run_is_charged_the_candidates_limit() -> None:
    sonnet = comparison.execution_limits("sonnet-medium").max_cost_usd
    allowance = budget.Allowance(available_usd=3.0)
    unknown = record("S01-cs")
    del unknown["result"]["usage"]
    run.charge_subject(allowance, [unknown], ["S01-cs", "S01-en"], repeats=1, execution_usd=sonnet)
    assert allowance.spent_usd == pytest.approx(2 * sonnet)
    assert allowance.uncertain_usd == pytest.approx(2 * sonnet)


# --- The expected measured cost -------------------------------------------------------------


def test_the_expected_cost_comes_from_the_pinned_prices_and_the_observed_usage() -> None:
    sonnet = comparison.CANDIDATES["sonnet-medium"].prices
    tokens = comparison.OBSERVED_CASE_RUN
    per_run = (tokens.input_tokens * sonnet.input + tokens.output_tokens * sonnet.output) / 1e6
    judged = sum(CASES[case_id].expectation.judged for case_id in SUBSET)
    assert judged == 8
    expected = len(SUBSET) * per_run + judged * comparison.OBSERVED_JUDGE_USD
    assert comparison.expected_cost_usd("sonnet-medium", SUBSET) == pytest.approx(expected)


@pytest.mark.parametrize("name", sorted(comparison.CANDIDATES))
def test_each_candidates_expected_cost_stays_within_the_per_run_limit(name: str) -> None:
    # The owner's per-run limit of USD 1.00 (`packages/llm-agent/AGENTS.md`, Evals).
    assert comparison.expected_cost_usd(name, SUBSET) <= comparison.PER_RUN_LIMIT_USD == 1.00


def test_a_haiku_comparison_reserves_within_the_per_run_limit() -> None:
    for name in ("haiku-high", "haiku-medium"):
        usd = comparison.execution_limits(name).max_cost_usd
        assert run.reservation(SUBSET, repeats=1, execution_usd=usd) <= 1.00


# --- Records of a comparison ----------------------------------------------------------------


def _candidate_record(case_id: str, name: str) -> dict[str, Any]:
    data = honest_unknown(case_id)
    stage = comparison.CANDIDATES[name]
    data["fingerprint"]["subject"] = {
        **data["fingerprint"]["subject"],
        "main_model": stage.model,
        "main_effort": stage.effort,
    }
    return data


def test_a_record_of_another_main_model_is_refused() -> None:
    good = _candidate_record("S01-en", "sonnet-medium")
    wrong = _candidate_record("S01-cs", "haiku-high")
    assert comparison.mismatches("sonnet-medium", [good]) == []
    problems = comparison.mismatches("sonnet-medium", [good, wrong])
    assert len(problems) == 1
    assert "S01-cs" in problems[0]
    assert "claude-haiku-5-5 high" in problems[0]


def test_comparison_answers_are_marked_and_never_regraded_into_a_gate_pool() -> None:
    data = record("S01-en")
    assert run.compatible_record(data, SUBJECT) is None
    comparison.mark("haiku-high", [data])
    assert data["comparison"] == {
        "version": comparison.COMPARISON_VERSION,
        "candidate": "haiku-high",
    }
    reason = run.compatible_record(data, SUBJECT)
    assert reason is not None
    assert "comparison" in reason


# --- The summary and the printed result -----------------------------------------------------


async def test_the_summary_records_the_execution_limit_and_the_expected_runs(
    tmp_path: Path,
) -> None:
    comparison.apply_main("sonnet-medium")
    stopped = honest_unknown("S01-cs")
    stopped["result"]["outcome"] = "limit_reached"
    graded = [
        await run.grade_record(honest_unknown("S01-en"), judge_model=None, allowance=None),
        await run.grade_record(stopped, judge_model=None, allowance=None),
    ]
    summary = run.write_summary(
        tmp_path,
        mode="compare",
        graded=graded,
        selected=["S01-en", "S01-cs", "S04-en"],
        extra_failures=[],
        allowance=None,
        subject=run.current_subject_versions(),
        candidate="sonnet-medium",
    )
    result = summary["comparison"]
    assert result["execution_limit"] == {
        "max_cost_usd": pytest.approx(comparison.execution_limits("sonnet-medium").max_cost_usd),
        "default_usd": 0.02,
    }
    assert result["cases"] == ["S01-en", "S01-cs", "S04-en"]
    assert result["case_runs"] == {"expected": 3, "recorded": 2}
    assert result["limit_reached"] == 1


async def test_a_finished_comparison_prints_no_fail_verdict(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    graded = [await run.grade_record(honest_unknown("S01-en"), judge_model=None, allowance=None)]
    summary = run.write_summary(
        tmp_path,
        mode="compare",
        graded=graded,
        selected=["S01-en", "S01-cs"],
        extra_failures=[],
        allowance=None,
        subject=SUBJECT,
        candidate="haiku-medium",
    )
    run.print_summary(summary, tmp_path)
    out = capsys.readouterr().out
    assert "comparison (not a gate)" in out
    assert "FAIL" not in out
    assert "case-runs 1 of 2 expected" in out


# --- The comparison run, driven with fakes --------------------------------------------------


@pytest.fixture
def fake_run(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> dict[str, Any]:
    """`command_run` with a fake test API and Promptfoo; records the Promptfoo call."""
    seen: dict[str, Any] = {"promptfoo": [], "records": []}
    monkeypatch.setenv("ANTHROPIC_API_KEY", "fake-key-never-used-0000")
    monkeypatch.setattr(run, "REPORT_ROOT", tmp_path / "reports")
    monkeypatch.setattr(run, "LEDGER", tmp_path / "reports" / "ledger.json")

    @contextlib.asynccontextmanager
    async def api(scratch: Path) -> AsyncIterator[Any]:
        yield SimpleNamespace(url="http://fake.invalid")

    async def person(url: str) -> dict[str, Any]:
        return {"name": "fixed"}

    async def promptfoo(output: Path, env: Mapping[str, str], *, repeats: int = 3) -> None:
        seen["promptfoo"].append({"env": dict(env), "repeats": repeats})
        cases = env["LLM_AGENT_EVAL_CASES"].split(",")
        results = [
            {"vars": {"case_id": item["case_id"]}, "response": {"output": json.dumps(item)}}
            for item in seen["records"]
            if item["case_id"] in cases
        ]
        text = json.dumps({"results": {"results": results}})
        await asyncio.to_thread(output.write_text, text, encoding="utf-8")

    monkeypatch.setattr(run, "start_api", api)
    monkeypatch.setattr(run, "read_person", person)
    monkeypatch.setattr(run, "check_fixture_person", lambda person: [])
    monkeypatch.setattr(run, "run_promptfoo", promptfoo)
    return seen


async def test_a_comparison_run_passes_the_candidate_repeats_once_and_marks_answers(
    fake_run: dict[str, Any],
) -> None:
    selected = ["S01-en", "S01-cs"]
    fake_run["records"] = [_candidate_record(case_id, "haiku-medium") for case_id in selected]
    assert await run.command_run(selected, 1.0, candidate="haiku-medium", campaign=P6) == 0
    (call,) = fake_run["promptfoo"]
    assert call["env"][comparison.ENVIRONMENT] == "haiku-medium"
    assert call["repeats"] == 1
    ledger = json.loads(run.LEDGER.read_text(encoding="utf-8"))
    assert ledger["runs"][0]["scope"] == "comparison"
    (folder,) = [path for path in run.REPORT_ROOT.iterdir() if path.is_dir()]
    stored = json.loads((folder / "answers" / "S01-en-1.json").read_text(encoding="utf-8"))
    assert stored["comparison"]["candidate"] == "haiku-medium"
    summary = json.loads((folder / "summary.json").read_text(encoding="utf-8"))
    assert summary["comparison"]["case_runs"] == {"expected": 2, "recorded": 2}


async def test_a_comparison_run_with_a_missing_case_run_exits_1(
    fake_run: dict[str, Any],
) -> None:
    fake_run["records"] = [_candidate_record("S01-en", "haiku-medium")]
    assert (
        await run.command_run(["S01-en", "S01-cs"], 1.0, candidate="haiku-medium", campaign=P6) == 1
    )


async def test_a_comparison_run_refuses_answers_of_another_main_model(
    fake_run: dict[str, Any],
) -> None:
    fake_run["records"] = [_candidate_record("S01-en", "haiku-high")]
    assert (
        await run.command_run(["S01-en"], 1.0, candidate="haiku-medium", campaign=P6) == run.BLOCKED
    )
    (folder,) = [path for path in run.REPORT_ROOT.iterdir() if path.is_dir()]
    assert not (folder / "answers").exists()


async def test_a_comparison_over_the_allowance_stops_before_anything_starts(
    fake_run: dict[str, Any],
) -> None:
    with pytest.raises(budget.BudgetBlockedError):
        await run.command_run(SUBSET, 1.0, candidate="sonnet-medium", campaign=P6)
    assert fake_run["promptfoo"] == []
    assert not run.LEDGER.exists()


# --- The side-by-side report ----------------------------------------------------------------


def _summary(
    name: str, cases: tuple[str, ...] = SUBSET, *, useful: int = 4, cost: float = 0.31
) -> dict[str, Any]:
    stage = comparison.CANDIDATES[name]
    ratio = {"passed": useful, "runs": 4, "rate": useful / 4}
    figures = {"useful": ratio, "citations": ratio, "false_blocking": ratio, "critical": ratio}
    return {
        "mode": "compare",
        "dataset_version": "dataset-x",
        "expectations_version": "expectations-x",
        "subject": {
            "pipeline": "chat-1",
            "runtime": "r1",
            "security_model": config.HAIKU,
            "security_effort": "medium",
            "main_model": stage.model,
            "main_effort": stage.effort,
            "pricing": config.PRICING_VERSION,
        },
        "judge": {"model": rubric.JUDGE_MODEL, "effort": rubric.JUDGE_EFFORT, "rubric": "v1"},
        "case_runs": [{"case": case_id, "latency_ms": 4000} for case_id in cases],
        "comparison": {
            "version": comparison.COMPARISON_VERSION,
            "candidate": name,
            "main": {"model": stage.model, "effort": stage.effort},
            "security": {"model": config.HAIKU, "effort": "medium"},
            "judge": {"model": rubric.JUDGE_MODEL, "effort": rubric.JUDGE_EFFORT},
            "repeats": 1,
            "subset": list(SUBSET),
            "cases": list(cases),
            "case_runs": {"expected": len(cases), "recorded": len(cases)},
            "limit_reached": 0,
            "execution_limit": {
                "max_cost_usd": comparison.execution_limits(name).max_cost_usd,
                "default_usd": 0.02,
            },
            "by_language": {"en": figures, "cs": figures},
            "latency_ms": {"runs": len(cases), "p50": 4000, "p95": 4000},
            "cost_usd": cost,
        },
    }


def test_the_side_by_side_report_lists_every_candidate_with_its_figures() -> None:
    lines = comparison.side_by_side(
        [_summary("haiku-high"), _summary("haiku-medium", useful=3), _summary("sonnet-medium")]
    )
    text = "\n".join(lines)
    assert "haiku-high" in text
    assert "haiku-medium" in text
    assert "3/4" in text
    assert "p50 4000" in text
    assert "0.3100" in text
    assert "execution limit 0.2606 USD" in text
    assert "case-runs 20 of 20" in text


def test_the_side_by_side_report_refuses_a_summary_that_is_no_comparison() -> None:
    with pytest.raises(ValueError, match="not a comparison"):
        comparison.side_by_side([{"mode": "run"}])
    other = _summary("haiku-high")
    other["comparison"]["version"] = "comparison-v0"
    with pytest.raises(ValueError, match="another comparison version"):
        comparison.side_by_side([other])


@pytest.mark.parametrize(
    ("path", "value"),
    [
        (("subject", "runtime"), "r2"),
        (("subject", "chat_prompt"), "p2"),
        (("subject", "security_effort"), "high"),
        (("subject", "pricing"), "anthropic-2027-01-01"),
        (("dataset_version",), "dataset-y"),
        (("expectations_version",), "expectations-y"),
        (("judge", "rubric"), "v2"),
        (("comparison", "security"), {"model": config.HAIKU, "effort": "high"}),
    ],
)
def test_the_report_refuses_summaries_that_differ_beyond_the_main_stage(
    path: tuple[str, ...], value: Any
) -> None:
    other = _summary("haiku-medium")
    target = other
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value
    with pytest.raises(ValueError, match="differ"):
        comparison.side_by_side([_summary("haiku-high"), other])


def test_the_report_merges_the_slices_of_one_candidate() -> None:
    first, second = SUBSET[:8], SUBSET[8:]
    lines = comparison.side_by_side(
        [
            _summary("haiku-high"),
            _summary("sonnet-medium", first, useful=3, cost=0.30),
            _summary("sonnet-medium", second, useful=4, cost=0.40),
        ]
    )
    text = "\n".join(lines)
    assert text.count("sonnet-medium") == 1
    assert "7/8" in text
    assert "0.7000" in text
    assert text.count("case-runs 20 of 20") == 2


def test_the_report_shows_a_short_candidate_and_refuses_a_repeated_case() -> None:
    text = "\n".join(comparison.side_by_side([_summary("sonnet-medium", SUBSET[:8])]))
    assert "case-runs 8 of 20" in text
    with pytest.raises(ValueError, match="twice"):
        comparison.side_by_side(
            [_summary("sonnet-medium", SUBSET[:8]), _summary("sonnet-medium", SUBSET[6:])]
        )


def test_a_corrupt_or_incomplete_summary_is_a_usage_error(tmp_path: Path) -> None:
    corrupt = tmp_path / "corrupt"
    corrupt.mkdir()
    (corrupt / "summary.json").write_text("{not json", encoding="utf-8")
    with pytest.raises(run.UsageError, match="not a JSON"):
        run.command_compare_report([corrupt])
    partial = tmp_path / "partial"
    partial.mkdir()
    incomplete = _summary("haiku-high")
    del incomplete["comparison"]["by_language"]
    (partial / "summary.json").write_text(json.dumps(incomplete), encoding="utf-8")
    with pytest.raises(run.UsageError, match="incomplete"):
        run.command_compare_report([partial])
    assert run.main(["--compare-report", str(partial)]) == run.BLOCKED
