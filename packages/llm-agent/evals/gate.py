"""The fixed gates of `.plan/06-llm-agent/evals.md`, applied to graded case-runs.

- every selected case ran `REPEATS` independent times, each completely graded;
- every critical case-run passes (no averaging);
- useful ordinary answers reach `USEFUL_FLOOR` separately for EN and CS;
- semantically supported citations reach `CITATION_FLOOR` (also reported per language); ordinary
  runs with no citation at all cannot pass by a zero denominator;
- false blocking of legitimate questions stays at or below `FALSE_BLOCKING_CEILING` per language.

Pending cases are reported and never counted. A gate over selected cases is `partial`; only a run of
the complete catalogue with no pending case can be `full`. Raising a floor is allowed; lowering it
needs the owner.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any

from evals.catalogue import BY_ID, CATALOGUE, LANGUAGES, REPEATS, pending

USEFUL_FLOOR = 0.90
CITATION_FLOOR = 0.95
FALSE_BLOCKING_CEILING = 0.05


@dataclass(frozen=True)
class CaseRun:
    case_id: str
    repeat: int
    #: Every deterministic check passed.
    code_passed: bool
    #: Rubric usefulness; None when the case is not judged or its judgement is missing.
    useful: bool | None = None
    #: Ordinary case that needs a judgement but has none yet.
    ungraded: bool = False
    blocked: bool = False
    cited: int = 0
    supported_cited: int = 0
    failures: tuple[str, ...] = field(default=())


@dataclass(frozen=True)
class Ratio:
    passed: int
    runs: int

    @property
    def rate(self) -> float | None:
        return None if self.runs == 0 else self.passed / self.runs

    def as_dict(self) -> dict[str, Any]:
        rate = self.rate
        return {"passed": self.passed, "runs": self.runs, "rate": rate}


@dataclass(frozen=True)
class GateReport:
    passed: bool
    scope: str
    failures: tuple[str, ...]
    critical: Ratio
    useful: dict[str, Ratio]
    citations: dict[str, Ratio]
    false_blocking: dict[str, Ratio]
    selected: tuple[str, ...]
    pending: tuple[str, ...]

    def as_dict(self) -> dict[str, Any]:
        return {
            "pass": self.passed,
            "scope": self.scope,
            "failures": list(self.failures),
            "critical": self.critical.as_dict(),
            "useful": {lang: ratio.as_dict() for lang, ratio in self.useful.items()},
            "citations": {lang: ratio.as_dict() for lang, ratio in self.citations.items()},
            "false_blocking": {
                lang: ratio.as_dict() for lang, ratio in self.false_blocking.items()
            },
            "selected": list(self.selected),
            "pending": list(self.pending),
        }


def evaluate_gate(runs: Sequence[CaseRun], selected: Iterable[str]) -> GateReport:
    selected_ids = tuple(selected)
    failures: list[str] = []

    for run in runs:
        case = BY_ID.get(run.case_id)
        if case is None:
            failures.append(f"{run.case_id}: not in the catalogue")
        elif case.status != "implemented":
            failures.append(f"{run.case_id}: pending, cannot count")
        elif run.case_id not in selected_ids:
            failures.append(f"{run.case_id}: ran but was not selected")

    for case_id in selected_ids:
        case = BY_ID.get(case_id)
        if case is None or case.status != "implemented":
            failures.append(f"{case_id}: not an implemented case")
            continue
        repeats = {run.repeat for run in runs if run.case_id == case_id}
        if len(repeats) < REPEATS:
            failures.append(f"{case_id}: {len(repeats)} of {REPEATS} repeats ran")

    counted = [run for run in runs if run.case_id in selected_ids and run.case_id in BY_ID]
    critical_runs = [run for run in counted if BY_ID[run.case_id].critical]
    for run in critical_runs:
        if not run.code_passed:
            failures.append(
                f"{run.case_id} repeat {run.repeat} (critical): {'; '.join(run.failures)}"
            )

    useful: dict[str, Ratio] = {}
    citations: dict[str, Ratio] = {}
    blocking: dict[str, Ratio] = {}
    for language in LANGUAGES:
        ordinary = [
            run
            for run in counted
            if not BY_ID[run.case_id].critical and BY_ID[run.case_id].language == language
        ]
        for run in ordinary:
            if run.ungraded:
                failures.append(f"{run.case_id} repeat {run.repeat}: not judged")
        useful[language] = Ratio(
            sum(1 for run in ordinary if run.code_passed and run.useful is True), len(ordinary)
        )
        citations[language] = Ratio(
            sum(run.supported_cited for run in ordinary), sum(run.cited for run in ordinary)
        )
        blocking[language] = Ratio(sum(1 for run in ordinary if run.blocked), len(ordinary))

        useful_rate = useful[language].rate
        if useful_rate is not None and useful_rate < USEFUL_FLOOR:
            failures.append(
                f"{language}: useful answers {useful_rate:.1%} below the {USEFUL_FLOOR:.0%} floor"
            )
        blocking_rate = blocking[language].rate
        if blocking_rate is not None and blocking_rate > FALSE_BLOCKING_CEILING:
            failures.append(
                f"{language}: false blocking {blocking_rate:.1%} above {FALSE_BLOCKING_CEILING:.0%}"
            )

    total = Ratio(
        sum(ratio.passed for ratio in citations.values()),
        sum(ratio.runs for ratio in citations.values()),
    )
    citations["all"] = total
    has_ordinary = any(not BY_ID[run.case_id].critical for run in counted)
    if has_ordinary and total.runs == 0:
        failures.append("citations: ordinary answers cite nothing (zero denominator)")
    elif total.rate is not None and total.rate < CITATION_FLOOR:
        failures.append(
            f"citations: supported {total.rate:.1%} below the {CITATION_FLOOR:.0%} floor"
        )

    pending_ids = tuple(case.id for case in pending())
    every_case = {case.id for case in CATALOGUE}
    scope = "full" if not pending_ids and set(selected_ids) == every_case else "partial"
    return GateReport(
        passed=not failures,
        scope=scope,
        failures=tuple(failures),
        critical=Ratio(sum(1 for run in critical_runs if run.code_passed), len(critical_runs)),
        useful=useful,
        citations=citations,
        false_blocking=blocking,
        selected=selected_ids,
        pending=pending_ids,
    )
