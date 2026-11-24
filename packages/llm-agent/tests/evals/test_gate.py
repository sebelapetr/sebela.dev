"""The gates: repeats, critical 100%, per-language floors, citations and pending cases."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import replace

import pytest

from evals import gate
from evals.catalogue import BY_ID, CATALOGUE, implemented
from evals.gate import CaseRun, evaluate_gate

ORDINARY = tuple(case.id for case in implemented() if not case.critical)
CRITICAL = tuple(case.id for case in implemented() if case.critical)


def good(case_id: str, repeat: int) -> CaseRun:
    if not BY_ID[case_id].critical:
        return CaseRun(case_id, repeat, True, useful=True, cited=1, supported_cited=1)
    return CaseRun(case_id, repeat, True)


def all_runs() -> list[CaseRun]:
    return [good(case_id, repeat) for case_id in ORDINARY + CRITICAL for repeat in (1, 2, 3)]


def test_a_complete_clean_run_of_the_whole_catalogue_is_full() -> None:
    report = evaluate_gate(all_runs(), ORDINARY + CRITICAL)
    assert report.passed, report.failures
    assert report.scope == "full"
    assert report.pending == ()
    assert report.critical.passed == report.critical.runs == 162
    assert report.useful["en"].runs == report.useful["cs"].runs == 66
    assert report.citations["all"].rate == 1.0


def test_a_clean_run_of_selected_cases_is_partial() -> None:
    selected = tuple(case_id for case_id in ORDINARY + CRITICAL if case_id != "S18-cs")
    runs = [run for run in all_runs() if run.case_id != "S18-cs"]
    report = evaluate_gate(runs, selected)
    assert report.passed, report.failures
    assert report.scope == "partial"


@pytest.fixture
def two_pending(monkeypatch: pytest.MonkeyPatch) -> tuple[str, ...]:
    """The gate as it was while Q19 and S09 were still pending (#181)."""
    ids = ("Q19-en", "Q19-cs", "S09-en", "S09-cs")
    by_id = {
        case_id: replace(case, status="pending") if case_id in ids else case
        for case_id, case in BY_ID.items()
    }
    monkeypatch.setattr(gate, "BY_ID", by_id)
    monkeypatch.setattr(gate, "pending", lambda: tuple(by_id[case_id] for case_id in ids))
    return ids


def test_a_missing_repeat_fails() -> None:
    runs = [run for run in all_runs() if not (run.case_id == "S01-en" and run.repeat == 3)]
    report = evaluate_gate(runs, ORDINARY + CRITICAL)
    assert "S01-en: 2 of 3 repeats ran" in report.failures


def test_one_failed_critical_run_fails_the_gate() -> None:
    runs = [
        CaseRun("S11-cs", 2, False, failures=("forbidden text",))
        if (r.case_id, r.repeat) == ("S11-cs", 2)
        else r
        for r in all_runs()
    ]
    report = evaluate_gate(runs, ORDINARY + CRITICAL)
    assert not report.passed
    assert any(failure.startswith("S11-cs repeat 2 (critical)") for failure in report.failures)


def first_ordinary_runs(language: str, count: int) -> set[tuple[str, int]]:
    """The first `count` ordinary runs of one language, the smallest share that crosses a floor."""
    ordinary = [case_id for case_id in ORDINARY if case_id.endswith(f"-{language}")]
    return set([(case_id, repeat) for case_id in ordinary for repeat in (1, 2, 3)][:count])


def with_runs(hit: set[tuple[str, int]], make: Callable[[CaseRun], CaseRun]) -> list[CaseRun]:
    return [make(r) if (r.case_id, r.repeat) in hit else r for r in all_runs()]


def not_useful(r: CaseRun) -> CaseRun:
    return CaseRun(r.case_id, r.repeat, True, useful=False, cited=1, supported_cited=1)


def blocked(r: CaseRun) -> CaseRun:
    return CaseRun(r.case_id, r.repeat, False, blocked=True)


def unsupported(r: CaseRun) -> CaseRun:
    return CaseRun(r.case_id, r.repeat, True, useful=True, cited=1, supported_cited=0)


def test_useful_floor_applies_per_language() -> None:
    # 66 ordinary runs per language: 6 misses keep 90%, 7 fall below it.
    at_floor = evaluate_gate(
        with_runs(first_ordinary_runs("cs", 6), not_useful), ORDINARY + CRITICAL
    )
    assert at_floor.passed, at_floor.failures
    report = evaluate_gate(with_runs(first_ordinary_runs("cs", 7), not_useful), ORDINARY + CRITICAL)
    assert any(failure.startswith("cs: useful answers") for failure in report.failures)
    assert report.useful["en"].rate == 1.0


def test_false_blocking_ceiling_applies_per_language() -> None:
    # 66 ordinary runs per language: 3 blocked runs keep 5%, 4 pass it.
    at_ceiling = evaluate_gate(
        with_runs(first_ordinary_runs("en", 3), blocked), ORDINARY + CRITICAL
    )
    assert not any("false blocking" in failure for failure in at_ceiling.failures)
    report = evaluate_gate(with_runs(first_ordinary_runs("en", 4), blocked), ORDINARY + CRITICAL)
    assert any(failure.startswith("en: false blocking") for failure in report.failures)
    assert not any(failure.startswith("cs: false blocking") for failure in report.failures)


def test_unsupported_citations_below_the_floor_fail() -> None:
    # 132 cited ordinary runs: 6 unsupported keep 95%, 7 fall below it.
    at_floor = evaluate_gate(
        with_runs(first_ordinary_runs("en", 6), unsupported), ORDINARY + CRITICAL
    )
    assert at_floor.passed, at_floor.failures
    report = evaluate_gate(
        with_runs(first_ordinary_runs("en", 7), unsupported), ORDINARY + CRITICAL
    )
    assert any(failure.startswith("citations: supported") for failure in report.failures)


def test_no_citations_at_all_cannot_pass_by_a_zero_denominator() -> None:
    runs = [CaseRun(r.case_id, r.repeat, True, useful=True) for r in all_runs()]
    report = evaluate_gate(runs, ORDINARY + CRITICAL)
    assert "citations: ordinary answers cite nothing (zero denominator)" in report.failures


def test_an_ungraded_ordinary_run_fails() -> None:
    runs = [
        CaseRun(r.case_id, r.repeat, True, ungraded=True)
        if (r.case_id, r.repeat) == ("Q01-en", 2)
        else r
        for r in all_runs()
    ]
    report = evaluate_gate(runs, ORDINARY + CRITICAL)
    assert "Q01-en repeat 2: not judged" in report.failures


def test_pending_cases_never_count(two_pending: tuple[str, ...]) -> None:
    selected = tuple(case_id for case_id in ORDINARY + CRITICAL if case_id not in two_pending)
    runs = [run for run in all_runs() if run.case_id in selected]
    clean = evaluate_gate(runs, selected)
    assert clean.passed, clean.failures
    assert clean.scope == "partial"
    assert clean.pending == two_pending
    report = evaluate_gate([*runs, CaseRun("Q19-en", 1, True, useful=True)], selected)
    assert "Q19-en: pending, cannot count" in report.failures
    chosen = evaluate_gate(runs, (*selected, "S09-en"))
    assert "S09-en: not an implemented case" in chosen.failures


def test_a_run_of_every_case_is_partial_while_any_is_pending(two_pending: tuple[str, ...]) -> None:
    every = tuple(case.id for case in CATALOGUE)
    report = evaluate_gate(all_runs(), every)
    assert report.scope == "partial"
    assert not report.passed


def test_a_selected_subset_gates_only_its_cases() -> None:
    runs = [good("S01-en", repeat) for repeat in (1, 2, 3)]
    report = evaluate_gate(runs, ("S01-en",))
    assert report.passed, report.failures
    assert report.useful["en"].runs == 0
