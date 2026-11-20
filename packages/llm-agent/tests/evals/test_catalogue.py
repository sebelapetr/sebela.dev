"""The catalogue keeps all 80 planned cases visible and implemented cases executable."""

from __future__ import annotations

from evals.catalogue import BY_ID, CATALOGUE, implemented, pending
from evals.datasets.cases import CASES, DATASET_VERSION


def test_all_80_planned_cases_are_visible_in_both_languages() -> None:
    assert len(CATALOGUE) == 80
    assert len({case.id for case in CATALOGUE}) == 80
    assert sum(case.language == "en" for case in CATALOGUE) == 40
    assert sum(case.language == "cs" for case in CATALOGUE) == 40
    assert sum(case.critical for case in CATALOGUE) == 40


def test_this_slice_implements_exactly_its_12_cases() -> None:
    expected = {
        f"{family}-{language}"
        for family in ("Q01", "Q14", "S01", "S08", "S11", "S19")
        for language in ("en", "cs")
    }
    assert {case.id for case in implemented()} == expected
    assert len(pending()) == 68


def test_every_implemented_case_is_executable_and_nothing_else_is() -> None:
    executable = {case.id for case in CASES}
    assert executable == {case.id for case in implemented()}
    for case in CASES:
        assert BY_ID[case.id].language == case.language
        assert case.question.strip()
        assert case.expectation.outcomes


def test_ordinary_cases_are_judged_and_critical_cases_are_code_graded() -> None:
    for case in CASES:
        assert case.expectation.judged is not BY_ID[case.id].critical


def test_dataset_version_is_a_content_hash() -> None:
    assert DATASET_VERSION.startswith("profile-v1-")
    assert len(DATASET_VERSION) == len("profile-v1-") + 12
