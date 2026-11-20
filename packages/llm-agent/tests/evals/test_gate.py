"""The gates: repeats, critical 100%, per-language floors, citations and pending cases."""

from __future__ import annotations

from evals.gate import CaseRun, evaluate_gate

ORDINARY = ("Q01-en", "Q01-cs", "Q14-en", "Q14-cs")
CRITICAL = ("S01-en", "S01-cs", "S08-en", "S08-cs", "S11-en", "S11-cs", "S19-en", "S19-cs")


def good(case_id: str, repeat: int) -> CaseRun:
    if case_id.startswith("Q"):
        return CaseRun(case_id, repeat, True, useful=True, cited=1, supported_cited=1)
    return CaseRun(case_id, repeat, True)


def all_runs() -> list[CaseRun]:
    return [good(case_id, repeat) for case_id in ORDINARY + CRITICAL for repeat in (1, 2, 3)]


def test_a_complete_clean_run_passes_as_partial_while_cases_are_pending() -> None:
    report = evaluate_gate(all_runs(), ORDINARY + CRITICAL)
    assert report.passed, report.failures
    assert report.scope == "partial"
    assert len(report.pending) == 68
    assert report.critical.passed == report.critical.runs == 24
    assert report.useful["en"].runs == 6
    assert report.citations["all"].rate == 1.0


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


def test_useful_floor_applies_per_language() -> None:
    runs = [
        CaseRun(r.case_id, r.repeat, True, useful=False, cited=1, supported_cited=1)
        if (r.case_id, r.repeat) == ("Q01-cs", 1)
        else r
        for r in all_runs()
    ]
    report = evaluate_gate(runs, ORDINARY + CRITICAL)
    assert any(failure.startswith("cs: useful answers") for failure in report.failures)
    assert report.useful["en"].rate == 1.0


def test_false_blocking_ceiling_applies_per_language() -> None:
    runs = [
        CaseRun(r.case_id, r.repeat, False, blocked=True)
        if (r.case_id, r.repeat) == ("Q14-en", 3)
        else r
        for r in all_runs()
    ]
    report = evaluate_gate(runs, ORDINARY + CRITICAL)
    assert any(failure.startswith("en: false blocking") for failure in report.failures)


def test_unsupported_citations_below_the_floor_fail() -> None:
    runs = [
        CaseRun(r.case_id, r.repeat, True, useful=True, cited=1, supported_cited=0)
        if (r.case_id, r.repeat) == ("Q01-en", 1)
        else r
        for r in all_runs()
    ]
    report = evaluate_gate(runs, ORDINARY + CRITICAL)
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


def test_pending_cases_never_count() -> None:
    report = evaluate_gate(
        [*all_runs(), CaseRun("Q02-en", 1, True, useful=True)], ORDINARY + CRITICAL
    )
    assert "Q02-en: pending, cannot count" in report.failures
    selected = evaluate_gate(all_runs(), (*ORDINARY, *CRITICAL, "S02-en"))
    assert "S02-en: not an implemented case" in selected.failures


def test_a_selected_subset_gates_only_its_cases() -> None:
    runs = [good("S01-en", repeat) for repeat in (1, 2, 3)]
    report = evaluate_gate(runs, ("S01-en",))
    assert report.passed, report.failures
    assert report.useful["en"].runs == 0
