"""The catalogue keeps all 88 planned cases visible and implemented cases executable."""

from __future__ import annotations

from dataclasses import replace

from evals.catalogue import BY_ID, CATALOGUE, implemented, pending
from evals.datasets.cases import CASES, DATASET_VERSION, FIXTURE, dataset_version


def test_all_88_planned_cases_are_visible_in_both_languages() -> None:
    assert len(CATALOGUE) == 88
    assert len({case.id for case in CATALOGUE}) == 88
    assert sum(case.language == "en" for case in CATALOGUE) == 44
    assert sum(case.language == "cs" for case in CATALOGUE) == 44
    assert sum(case.critical for case in CATALOGUE) == 44


SLICE_01 = ("Q01", "Q14", "S01", "S08", "S11", "S19")
SLICE_02 = (
    *("Q02", "Q03", "Q04", "Q05", "Q06", "Q07", "Q15", "Q16"),
    *("S02", "S03", "S04", "S06", "S07", "S10", "S20"),
)
SLICE_03 = ("Q08", "Q09", "Q10", "Q11", "Q12", "Q13", "S05")
SLICE_04 = ("Q17", "Q18", "S17")


SLICE_05 = ("Q19", "Q20", "S09", "S12", "S13", "S14", "S15", "S16", "S18")
COMPACTION = ("C03", "C04", "C05", "C06")


def test_the_slices_implement_all_88_cases_and_none_is_pending() -> None:
    expected = {
        f"{family}-{language}"
        for family in (*SLICE_01, *SLICE_02, *SLICE_03, *SLICE_04, *SLICE_05, *COMPACTION)
        for language in ("en", "cs")
    }
    assert {case.id for case in implemented()} == expected
    assert len(expected) == 88
    assert pending() == ()
    assert {BY_ID[f"{family}-en"].slice for family in SLICE_02} == {"S02"}
    assert {BY_ID[f"{family}-cs"].slice for family in SLICE_03} == {"S03"}
    assert {BY_ID[f"{family}-{lang}"].slice for family in SLICE_04 for lang in ("en", "cs")} == {
        "S04"
    }
    assert {BY_ID[f"{family}-{lang}"].slice for family in SLICE_05 for lang in ("en", "cs")} == {
        "S05"
    }
    assert {BY_ID[f"{family}-{lang}"].slice for family in COMPACTION for lang in ("en", "cs")} == {
        "#213"
    }
    assert [BY_ID[f"{family}-en"].critical for family in COMPACTION] == [False, False, True, True]


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


def test_the_dataset_version_covers_what_the_agent_sees_not_the_expectations() -> None:
    # A grader fix (an expectation) keeps stored answers regradable; a changed question does not.
    case = CASES[0]
    stricter = replace(case.expectation, forbidden_text=(*case.expectation.forbidden_text, "x"))
    regraded = [replace(case, expectation=stricter), *CASES[1:]]
    reworded = [replace(case, question=case.question + "?"), *CASES[1:]]
    assert dataset_version(regraded, FIXTURE) == DATASET_VERSION
    assert dataset_version(reworded, FIXTURE) != DATASET_VERSION
    assert dataset_version(CASES, {**FIXTURE, "projects": []}) != DATASET_VERSION


def test_the_fixture_is_every_seed_file_of_the_folder() -> None:
    assert set(FIXTURE) == {
        "person",
        "organizations",
        "technologies",
        "topics",
        "experiences",
        "projects",
        "explorations",
        "services",
        "education",
        "current-focus",
        "roadmap-areas",
        "roadmap-modules",
        "roadmap-resources",
        "roadmap-books",
        "roadmap-events",
        "roadmap-diary",
        "roadmap-time-entries",
    }
