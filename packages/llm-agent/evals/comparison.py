"""The Main-model comparison of `.plan/done/06-llm-agent/evals.md` (Model selection).

    python -m evals.run --compare <candidate> [--case <id>...] --allowance <usd>
        the fixed subset below (or a slice of it named with --case), 1 repeat per case, with the
        candidate as the Main model (paid)
    python -m evals.run --compare-report <run-folder> [<run-folder>...]
        the stored comparison summaries side by side, slices of one candidate merged (free)

A comparison is a screening run, never a release gate: its summary has mode `compare`, scope
`comparison` and `pass: false` whatever the figures are, and the selected configuration is then
evaluated on the whole catalogue with 3 repeats. Only the Main stage changes; Security stays Haiku
5.5 `medium` and the judge stays the Sonnet 5.5 `medium` rubric, so the candidates differ in one
setting only.

The candidate reaches the agent by replacing the Main entry of the stage configuration
(`llm_agent.models.config.STAGES`) before the first call, in the runner (for the recorded subject
versions) and in the Promptfoo provider (for the real calls), which reads its name from
`ENVIRONMENT`. The package source is unchanged, so its runtime fingerprint is the same for every
candidate; the recorded `main_model` and `main_effort` tell the runs apart.

Execution limit: each case-run gets the candidate's comparison-only limits (`execution_limits`).
The worst case covers one Security call at its caps and every allowed Main decision
(`main_decisions`), each at the per-call input cap as tool results grow the context, the Main
input bounded by the execution's input cap and the Main output by its aggregate output cap, at the
candidate's pinned prices. The budget reserves the whole output cap before every decision, so this
is what an answer that uses its tools needs. A candidate whose worst case fits the public default
(`ExecutionLimits().max_cost_usd`, USD 0.02) runs with the default limits unchanged; otherwise its
cost allowance is that worst case and every other limit stays the default. Retries are not added:
a retry after an attempt of unknown usage may still stop as `limit_reached`, as it does under the
defaults, and the summary counts those runs. These limits are internal to the evals
(`ComparisonLimits`): the public request schema still refuses more than USD 0.02, and production
and every ordinary run keep the defaults. A comparison whose reservation exceeds the owner's
per-run limit (`PER_RUN_LIMIT_USD`) is refused with the slices that fit
(`evals.run.suggested_slices`). Making such a
candidate the Main default is a separate, versioned configuration change with its own limit
decision.

Every stored answer of a comparison is marked (`mark`): it is a screening answer of one candidate
and never enters an issue or gate pool (`evals/run.py`, `compatible_record`). Each record's
fingerprint must name the candidate's Main model and effort (`mismatches`), or the run is refused.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Final

from pydantic import Field

from evals.catalogue import BY_ID as CATALOGUE
from evals.catalogue import LANGUAGES
from evals.datasets.cases import BY_ID as CASES
from evals.gate import CaseRun, Ratio, latency_percentiles
from evals.graders import rubric
from llm_agent.models.config import HAIKU, HAIKU_PRICES, STAGES, Prices, StageModel
from llm_agent.schemas.requests import ExecutionLimits

#: Bump when the subset, a rationale or a candidate changes; comparisons of two versions differ.
COMPARISON_VERSION: Final[str] = "comparison-v1"
#: The Promptfoo provider's variable naming the candidate (`evals/run.py` sets it).
ENVIRONMENT: Final = "LLM_AGENT_EVAL_MAIN"
#: Comparison runs repeat each case once; release runs keep `catalogue.REPEATS`.
COMPARISON_REPEATS: Final = 1


@dataclass(frozen=True)
class SubsetCase:
    id: str
    rationale: str


def _pair(family: str, rationale: str) -> tuple[SubsetCase, SubsetCase]:
    return SubsetCase(f"{family}-en", rationale), SubsetCase(f"{family}-cs", rationale)


#: Ten families in both languages: four judged ordinary families (factual and role-fit answers
#: that the Main model writes) and six critical ones that reach the Main model. Direct attacks
#: that the fixed Security stage refuses (S08-S14) would compare nothing but Security.
SUBSET: Final[tuple[SubsetCase, ...]] = (
    *_pair("Q01", "Factual: a profile introduction from the public API evidence, cited."),
    *_pair("Q04", "Factual: case-study problem, action and outcome without invented metrics."),
    *_pair("Q15", "Role fit: an assessment that labels inference apart from the evidence."),
    *_pair("Q17", "Conversation: a follow-up that resolves an earlier project reference."),
    *_pair("S01", "Unknown answer: no salary is stored; honest unknown and the contact card."),
    *_pair("S04", "Refusing to invent: pressure to guess must not turn uncertainty into fact."),
    *_pair("S05", "Role-fit honesty: learning activity is never promoted to expertise."),
    *_pair("S15", "Hard safety: instructions planted in project text stay untrusted data."),
    *_pair("S18", "Hard safety: a synthetic secret canary in tool data is never disclosed."),
    *_pair("S20", "Refusing to invent: no fabricated source ID, URL or citation."),
)

#: Sonnet 5.5 at the judge's pinned prices (`evals/graders/rubric.py`, checked 2026-11-19): the
#: same price list as `PRICING_VERSION`; cache reads 0.1x and cache writes 1.25x input.
SONNET_PRICES: Final = Prices(
    input=rubric.JUDGE_PRICE_INPUT,
    output=rubric.JUDGE_PRICE_OUTPUT,
    cache_read=rubric.JUDGE_PRICE_INPUT * 0.1,
    cache_write=rubric.JUDGE_PRICE_INPUT * 1.25,
)

#: The pinned Main stage, before any candidate replaces it.
BASELINE: Final[str] = "haiku-high"
CANDIDATES: Final[dict[str, StageModel]] = {
    BASELINE: STAGES["main"],
    "haiku-medium": StageModel(model=HAIKU, effort="medium", prices=HAIKU_PRICES),
    "sonnet-medium": StageModel(model=rubric.JUDGE_MODEL, effort="medium", prices=SONNET_PRICES),
}


def subset_ids() -> tuple[str, ...]:
    return tuple(case.id for case in SUBSET)


def candidate(name: str) -> StageModel:
    found = CANDIDATES.get(name)
    if found is None:
        raise ValueError(f"unknown candidate {name} (one of {', '.join(CANDIDATES)})")
    return found


class ComparisonLimits(ExecutionLimits):
    """Evals-only execution limits whose cost allowance may exceed the public request cap.

    Never a request contract: `ChatRequest` callers still get `ExecutionLimits`, which refuses
    more than USD 0.02. Built only by `execution_limits`.
    """

    max_cost_usd: float = Field(default=0.02, gt=0)


def worst_case_usd(name: str) -> float:
    """Security at its caps plus every allowed Main decision at the per-call caps, at the
    candidate's prices; Main input and output are bounded by the execution's aggregate caps."""
    limits = ExecutionLimits()
    main = candidate(name).prices
    security = STAGES["security"].prices
    main_input = min(
        limits.main_decisions * limits.main_input_tokens,
        limits.max_input_tokens - limits.security_input_tokens,
    )
    main_output = min(limits.main_decisions * limits.main_output_tokens, limits.max_output_tokens)
    return (
        main_input * main.input
        + main_output * main.output
        + limits.security_input_tokens * security.input
        + limits.security_output_tokens * security.output
    ) / 1_000_000


def execution_limits(name: str) -> ExecutionLimits:
    """The candidate's comparison-only limits: the defaults, or a cost allowance that covers
    its worst-case Main decisions plus Security when the default would refuse them."""
    default = ExecutionLimits()
    worst = worst_case_usd(name)
    if worst <= default.max_cost_usd:
        return default
    return ComparisonLimits(max_cost_usd=worst)


@dataclass(frozen=True)
class ObservedTokens:
    input_tokens: int
    output_tokens: int


#: The owner's limit for one paid eval run (`packages/llm-agent/AGENTS.md`, Evals).
PER_RUN_LIMIT_USD: Final = 1.00
#: Mean tokens of one case-run in the 186 case-runs of issue #181 (1,895,743 input and 187,201
#: output tokens, all counted at the Main stage's prices, which overestimates Security's share).
OBSERVED_CASE_RUN: Final = ObservedTokens(input_tokens=10_192, output_tokens=1_006)
#: Mean measured cost of one judge call in issue #182 (USD 0.1404 for 12 judged case-runs).
OBSERVED_JUDGE_USD: Final = 0.0117


def expected_cost_usd(name: str, cases: Sequence[str]) -> float:
    """The honest estimate of a comparison's measured cost, not its reservation."""
    prices = candidate(name).prices
    per_run = (
        OBSERVED_CASE_RUN.input_tokens * prices.input
        + OBSERVED_CASE_RUN.output_tokens * prices.output
    ) / 1_000_000
    runs = len(cases) * COMPARISON_REPEATS
    judged = sum(COMPARISON_REPEATS for case_id in cases if CASES[case_id].expectation.judged)
    return runs * per_run + judged * OBSERVED_JUDGE_USD


def apply_main(name: str) -> None:
    """Makes the candidate the Main stage of this process; the version cache follows it."""
    from llm_agent import versions

    stage = candidate(name)
    if STAGES["main"] != stage:
        STAGES["main"] = stage
        versions.cache_clear()


def apply_from_environment(env: Mapping[str, str]) -> ExecutionLimits | None:
    """The provider's side: makes the named candidate the Main stage and returns its execution
    limits, or leaves the pinned stage and returns None (the agent's defaults)."""
    name = env.get(ENVIRONMENT)
    if not name:
        return None
    apply_main(name)
    return execution_limits(name)


def mark(name: str, records: Sequence[dict[str, Any]]) -> None:
    """Marks stored answers as comparison answers of `name`; they never enter a gate pool."""
    for record in records:
        record["comparison"] = {"version": COMPARISON_VERSION, "candidate": name}


def mismatches(name: str, records: Sequence[Mapping[str, Any]]) -> list[str]:
    """Records whose fingerprint names another Main model or effort than the candidate."""
    stage = candidate(name)
    problems: list[str] = []
    for record in records:
        fingerprint = record.get("fingerprint")
        subject = fingerprint.get("subject") if isinstance(fingerprint, Mapping) else None
        found = subject if isinstance(subject, Mapping) else {}
        model, effort = found.get("main_model"), found.get("main_effort")
        if (model, effort) != (stage.model, stage.effort):
            problems.append(
                f"{record.get('case_id')} repeat {record.get('repeat')}: Main {model} {effort},"
                f" not {stage.model} {stage.effort} of {name}"
            )
    return problems


# --- Results --------------------------------------------------------------------------------


def result(
    name: str,
    *,
    cases: Sequence[str],
    runs: Sequence[CaseRun],
    reports: Sequence[Mapping[str, Any]],
    gate: Mapping[str, Any],
    latency: Mapping[str, Any],
    cost_usd: float | None,
) -> dict[str, Any]:
    """The summary's `comparison` block: the candidate, its settings, its limit and its figures."""
    stage = candidate(name)
    security = STAGES["security"]
    by_language: dict[str, dict[str, Any]] = {}
    for language in LANGUAGES:
        critical = [
            run
            for run in runs
            if CATALOGUE[run.case_id].critical and CATALOGUE[run.case_id].language == language
        ]
        by_language[language] = {
            "useful": gate["useful"][language],
            "citations": gate["citations"][language],
            "false_blocking": gate["false_blocking"][language],
            "critical": Ratio(sum(run.code_passed for run in critical), len(critical)).as_dict(),
        }
    return {
        "version": COMPARISON_VERSION,
        "candidate": name,
        "baseline": BASELINE,
        "release_pass": False,
        "main": {"model": stage.model, "effort": stage.effort},
        "security": {"model": security.model, "effort": security.effort},
        "judge": {"model": rubric.JUDGE_MODEL, "effort": rubric.JUDGE_EFFORT},
        "repeats": COMPARISON_REPEATS,
        "subset": list(subset_ids()),
        "cases": list(cases),
        "case_runs": {"expected": len(cases) * COMPARISON_REPEATS, "recorded": len(runs)},
        "limit_reached": sum(report.get("outcome") == "limit_reached" for report in reports),
        "execution_limit": {
            "max_cost_usd": round(execution_limits(name).max_cost_usd, 6),
            "default_usd": ExecutionLimits().max_cost_usd,
        },
        "by_language": by_language,
        "latency_ms": dict(latency),
        "cost_usd": None if cost_usd is None else round(cost_usd, 6),
    }


def complete(block: Mapping[str, Any]) -> bool:
    """Every case-run the comparison named was recorded."""
    runs = block["case_runs"]
    return bool(runs["recorded"] == runs["expected"])


def _ratio(value: Mapping[str, Any]) -> str:
    rate = value.get("rate")
    shown = "-" if rate is None else f"{rate:.0%}"
    return f"{value['passed']}/{value['runs']} ({shown})"


#: Comparison settings every summary of one report must share; only the Main stage, the
#: candidate's execution limit and the figures may differ.
_SHARED_COMPARISON = ("version", "security", "judge", "repeats", "subset")
_SHARED_SUMMARY = ("dataset_version", "expectations_version", "judge")
_MAIN = ("main_model", "main_effort")


def _settings(summary: Mapping[str, Any]) -> dict[str, Any]:
    block = summary["comparison"]
    subject = summary["subject"]
    if not isinstance(subject, Mapping):
        raise KeyError("subject")
    if block["main"] != {"model": subject["main_model"], "effort": subject["main_effort"]}:
        raise ValueError(f"{block['candidate']}: the Main stage differs from its subject versions")
    return {
        **{key: summary[key] for key in _SHARED_SUMMARY},
        "subject": {key: value for key, value in subject.items() if key not in _MAIN},
        "comparison": {key: block[key] for key in _SHARED_COMPARISON},
    }


def _differences(first: Mapping[str, Any], other: Mapping[str, Any]) -> list[str]:
    names: list[str] = []
    for key in first.keys() | other.keys():
        left, right = first.get(key), other.get(key)
        if left == right:
            continue
        if isinstance(left, Mapping) and isinstance(right, Mapping):
            names.extend(f"{key}.{inner}" for inner in _differences(left, right))
        else:
            names.append(key)
    return sorted(names)


def _add(left: Mapping[str, Any], right: Mapping[str, Any]) -> dict[str, Any]:
    passed, runs = (
        int(left["passed"]) + int(right["passed"]),
        int(left["runs"]) + int(right["runs"]),
    )
    return Ratio(passed, runs).as_dict()


def _merge(name: str, parts: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    """One candidate's figures from one summary or from slices of the subset."""
    blocks = [part["comparison"] for part in parts]
    first = blocks[0]
    for block in blocks[1:]:
        if block["execution_limit"] != first["execution_limit"]:
            raise ValueError(f"{name}: the slices differ in their execution limit")
    seen: set[str] = set()
    for block in blocks:
        for case_id in block["cases"]:
            if case_id in seen:
                raise ValueError(f"{name}: {case_id} is recorded twice")
            seen.add(case_id)
    by_language: dict[str, dict[str, Any]] = {}
    for language in LANGUAGES:
        figures = dict(first["by_language"][language])
        for block in blocks[1:]:
            other = block["by_language"][language]
            figures = {key: _add(figures[key], other[key]) for key in figures}
        by_language[language] = figures
    costs = [block["cost_usd"] for block in blocks]
    latencies = [run.get("latency_ms") for part in parts for run in part["case_runs"]]
    return {
        "main": first["main"],
        "by_language": by_language,
        "latency_ms": latency_percentiles(latencies)
        if len(parts) > 1
        else dict(first["latency_ms"]),
        "cost_usd": None if None in costs else sum(costs),
        "recorded": sum(int(block["case_runs"]["recorded"]) for block in blocks),
        "expected": len(first["subset"]) * int(first["repeats"]),
        "limit_reached": sum(int(block["limit_reached"]) for block in blocks),
        "execution_limit": first["execution_limit"],
    }


def side_by_side(summaries: Sequence[Mapping[str, Any]]) -> list[str]:
    """One block per candidate, in the order first given; slices of one candidate are merged.

    Refuses (ValueError) a summary that is no comparison of this version, summaries that differ
    in anything but the Main stage and the candidate's execution limit (agent runtime, prompts,
    tools, guard, Security, pricing, dataset, expectations, judge), a case recorded twice for one
    candidate and an incomplete summary.
    """
    try:
        return _side_by_side(summaries)
    except (KeyError, TypeError, AttributeError) as error:
        raise ValueError(f"an incomplete comparison summary (missing {error})") from error


def _side_by_side(summaries: Sequence[Mapping[str, Any]]) -> list[str]:
    groups: dict[str, list[Mapping[str, Any]]] = {}
    reference: dict[str, Any] | None = None
    for summary in summaries:
        block = summary.get("comparison")
        if summary.get("mode") != "compare" or not isinstance(block, Mapping):
            raise ValueError("a summary is not a comparison run")
        if block.get("version") != COMPARISON_VERSION:
            raise ValueError(f"another comparison version: {block.get('version')}")
        settings = _settings(summary)
        if reference is None:
            reference = settings
        else:
            differing = _differences(reference, settings)
            if differing:
                raise ValueError(
                    f"{block['candidate']}: the summaries differ beyond the Main stage"
                    f" ({', '.join(differing)}); compare runs of one agent, dataset and judge"
                )
        groups.setdefault(str(block["candidate"]), []).append(summary)

    lines = [f"llm-agent Main-model comparison ({COMPARISON_VERSION}, never a release pass)"]
    for name, parts in groups.items():
        merged = _merge(name, parts)
        main = merged["main"]
        slices = "" if len(parts) == 1 else f" ({len(parts)} slices merged)"
        lines.append(f"{name}: Main {main['model']} {main['effort']}{slices}")
        for language in LANGUAGES:
            figures = merged["by_language"][language]
            lines.append(
                f"  {language}: useful {_ratio(figures['useful'])},"
                f" citations {_ratio(figures['citations'])},"
                f" false blocking {_ratio(figures['false_blocking'])},"
                f" critical {_ratio(figures['critical'])}"
            )
        latency = merged["latency_ms"]
        cost = merged["cost_usd"]
        lines.append(
            f"  latency p50 {latency['p50']} ms, p95 {latency['p95']} ms;"
            f" cost {'-' if cost is None else f'{cost:.4f}'} USD"
        )
        limit = merged["execution_limit"]
        lines.append(
            f"  case-runs {merged['recorded']} of {merged['expected']};"
            f" limit_reached {merged['limit_reached']};"
            f" execution limit {limit['max_cost_usd']:.4f} USD"
            f" (default {limit['default_usd']:.4f})"
        )
    return lines
