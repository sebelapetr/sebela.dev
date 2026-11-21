"""Runs the implemented model evals of the Python chat agent and applies their gates.

    python -m evals.run --case <id> [--case <id>...] --allowance <usd>
        the named implemented cases, 3 independent repeats each (paid; run it as
        `pnpm --filter @sebela/llm-agent eval -- ...`, which supplies the key through
        `harness/with-secrets.mjs`). Issues run the cases their change affects.
    python -m evals.run --all --allowance <usd>
        every implemented case (paid; the summary's scope stays `partial` while any case is pending)
    python -m evals.run --regrade <run-folder> [--judge --allowance <usd>]
        grade a stored run's answers again with the current graders: free without `--judge`
        (compatible stored judgements are reused; changed ones stay ungraded and fail); with
        `--judge`, missing or incompatible judgements are bought again (paid)
    python -m evals.run --compare <candidate> [--case <id>...] --allowance <usd>
        the fixed comparison subset of `evals/comparison.py` (or a slice of it named with
        `--case`), 1 repeat per case, with the named candidate as the Main model and its
        comparison-only execution limits (paid; a screening comparison, never a release pass)
    python -m evals.run --compare-report <run-folder> [<run-folder>...]
        the comparison summaries of those runs side by side, slices of one candidate merged (free)
    python -m evals.run --check-fixture
        start and stop the fictional test API and read the fixture through it (free)

An unknown option, an unknown, pending or repeated case, a regrade with case options, or an unknown
candidate stops the runner before any setting is read, fixture started or model called.

Budget (`evals/budget.py`): every paid command states the campaign's remaining allowance with
`--allowance`; the run may spend at most that, capped by what this checkout's ledger leaves of the
cumulative USD 10 ceiling. Before the subject runs, every case-run is reserved at the agent's own
execution allowance (in a comparison, the candidate's; `comparison.execution_limits`) and every
judge call at its upper bound; a reservation over the allowance is a
block (exit 2) before anything is paid. A missing model key is the same visible block, never a
pass. Unmeasured spend consumes its whole reservation.

Every case-run's approved result is kept in the run folder's `answers/` (local, git-ignored,
written only after the credential scan found nothing), so a grader fix is checked with `--regrade`
instead of a new paid run. The redacted `summary.json` holds outcomes, reasons, tool names,
tokens, latency percentiles, cost and versions; it never stores an answer, its sources or the
evidence as such, but a grader failure message may quote a short fragment of an answer (the
answers are about the fictional fixture only).

One fictional test API serves every case-run of a run (`datasets/fixtures/profile`); the runner
reads the person before and after through it, so a mutation request (S11) passes only when the
content is unchanged. Needs the running Postgres of this worktree and the API built first
(`pnpm --filter "@sebela/api..." build`).
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import math
import os
import re
import shutil
import signal
import subprocess
import sys
from collections.abc import AsyncIterator, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from evals import anomaly, budget, comparison, judging
from evals.catalogue import BY_ID as CATALOGUE
from evals.catalogue import REPEATS, implemented
from evals.datasets.cases import BY_ID as CASES
from evals.datasets.cases import (
    DATASET_VERSION,
    EXPECTATIONS_VERSION,
    FIXTURE_FOLDER,
    FIXTURE_PERSON,
)
from evals.gate import CaseRun, evaluate_gate, latency_percentiles
from evals.graders import rubric
from evals.graders.code import fixture_contact, grade_code
from evals.provider import RECORD_SCHEMA

PROMPTFOO = "promptfoo@0.126.0"
EVALS_FOLDER = Path(__file__).resolve().parent
PACKAGE_FOLDER = EVALS_FOLDER.parent
REPOSITORY_ROOT = PACKAGE_FOLDER.parent.parent
API_FOLDER = REPOSITORY_ROOT / "apps" / "api"
REPORT_ROOT = REPOSITORY_ROOT / ".tmp" / "evals" / "llm-agent"
LEDGER = REPORT_ROOT / "ledger.json"
READY = re.compile(r"e2e API listening on (http://\S+)")
#: Exit codes: 0 gate passed, 1 gate failed, 2 blocked (usage, key, budget, credential leak).
BLOCKED = 2

#: Parent variables the Promptfoo process may see (no database or other checkout setting).
INHERITED = (
    "PATH",
    "HOME",
    "USER",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "ANTHROPIC_API_KEY",
)
#: Environment files the test API reads, as the API's own scripts do (`apps/api/package.json`).
API_ENV_FILES = ("../../.env.example", "../../.env", "../../.env.local")


#: How the judge is asked: one Message Batches API batch (default, half price) or one direct call
#: per case-run (debugging).
JUDGE_MODES = ("batch", "direct")


class UsageError(Exception):
    """The command line is invalid; nothing was started."""


@dataclass(frozen=True)
class Plan:
    mode: str  # "run" | "compare" | "compare-report" | "regrade" | "check-fixture"
    cases: tuple[str, ...] = ()
    allowance_usd: float | None = None
    regrade: Path | None = None
    judge: bool = False
    candidate: str | None = None
    folders: tuple[Path, ...] = ()
    judge_mode: str = "batch"  # "batch" (Message Batches API) | "direct" (debugging)


def plan(argv: Sequence[str]) -> Plan:
    """Validates the command line completely before anything is read, started or paid."""
    cases: list[str] = []
    allowance: str | None = None
    regrade: str | None = None
    judge = False
    every = False
    check = False
    compare: str | None = None
    report: list[str] | None = None
    judge_mode: str | None = None
    others = False
    args = list(argv)
    while args:
        option = args.pop(0)
        if option != "--compare-report":
            others = True
        if option == "--compare-report":
            if report is not None:
                raise UsageError("--compare-report given twice")
            report = []
            while args and not args[0].startswith("--"):
                report.append(args.pop(0))
        elif option == "--compare":
            if not args or args[0].startswith("--"):
                raise UsageError("--compare needs a value (a candidate name)")
            if compare is not None:
                raise UsageError("--compare given twice")
            compare = args.pop(0)
        elif option in ("--case", "--allowance", "--regrade"):
            if not args or args[0].startswith("--"):
                raise UsageError(f"{option} needs a value")
            value = args.pop(0)
            if option == "--case":
                cases.append(value)
            elif option == "--allowance":
                if allowance is not None:
                    raise UsageError("--allowance given twice")
                allowance = value
            else:
                if regrade is not None:
                    raise UsageError("--regrade given twice")
                regrade = value
        elif option == "--judge-mode":
            if not args or args[0].startswith("--"):
                raise UsageError("--judge-mode needs a value (batch or direct)")
            if judge_mode is not None:
                raise UsageError("--judge-mode given twice")
            judge_mode = args.pop(0)
            if judge_mode not in JUDGE_MODES:
                raise UsageError(f"--judge-mode is batch or direct, not {judge_mode}")
        elif option == "--all":
            every = True
        elif option == "--judge":
            judge = True
        elif option == "--check-fixture":
            check = True
        else:
            raise UsageError(f"unknown option {option}")

    if report is not None:
        if others:
            raise UsageError("--compare-report takes no other option")
        if not report:
            raise UsageError("--compare-report needs one or more run folders")
        return Plan(mode="compare-report", folders=tuple(Path(folder) for folder in report))

    if check:
        if cases or every or regrade or judge or allowance or compare or judge_mode:
            raise UsageError("--check-fixture takes no other option")
        return Plan(mode="check-fixture")

    if compare is not None:
        if every or regrade or judge:
            raise UsageError(
                "--compare runs the fixed subset (or a --case slice of it) with 1 repeat;"
                " it takes no --all, --regrade or --judge"
            )
        try:
            comparison.candidate(compare)
        except ValueError as error:
            raise UsageError(str(error)) from error
        subset = comparison.subset_ids()
        named: list[str] = []
        for case_id in cases:
            if case_id not in subset:
                raise UsageError(f"{case_id} is not in the comparison subset")
            if case_id in named:
                raise UsageError(f"{case_id} named twice")
            named.append(case_id)
        if allowance is None:
            raise UsageError(
                "a paid run needs --allowance <usd> (the campaign's remaining allowance)"
            )
        chosen = tuple(named) if named else subset
        mode = judge_mode or "batch"
        reserved = reservation(
            chosen, repeats=1, execution_usd=execution_usd_for(compare), judge_mode=mode
        )
        if reserved > comparison.PER_RUN_LIMIT_USD + 1e-12:
            pieces = "; ".join(
                " ".join(f"--case {case_id}" for case_id in piece)
                for piece in suggested_slices(compare, chosen, judge_mode=mode)
            )
            raise UsageError(
                f"--compare {compare} reserves {reserved:.4f} USD, above the USD"
                f" {comparison.PER_RUN_LIMIT_USD:.2f} per-run limit; run it in slices: {pieces}"
            )
        return Plan(
            mode="compare",
            cases=chosen,
            allowance_usd=_allowance(allowance),
            candidate=compare,
            judge_mode=judge_mode or "batch",
        )

    usd = _allowance(allowance) if allowance is not None else None
    if regrade is not None:
        if cases or every:
            raise UsageError("--regrade grades stored answers; it takes no --case or --all")
        if judge and usd is None:
            raise UsageError("--judge is paid and needs --allowance")
        if not judge and usd is not None:
            raise UsageError("--allowance applies only to a paid run or --judge")
        if not judge and judge_mode is not None:
            raise UsageError("--judge-mode applies only to a paid run or --judge")
        return Plan(
            mode="regrade",
            regrade=Path(regrade),
            judge=judge,
            allowance_usd=usd,
            judge_mode=judge_mode or "batch",
        )

    if judge:
        raise UsageError("--judge applies only to --regrade")
    if every and cases:
        raise UsageError("--all and --case exclude each other")
    if every:
        cases = [case.id for case in implemented()]
    if not cases:
        raise UsageError("name the cases with --case <id> (or --all)")
    seen: set[str] = set()
    for case_id in cases:
        entry = CATALOGUE.get(case_id)
        if entry is None:
            raise UsageError(f"unknown case {case_id}")
        if entry.status != "implemented" or case_id not in CASES:
            raise UsageError(f"{case_id} is pending and cannot run")
        if case_id in seen:
            raise UsageError(f"{case_id} named twice")
        seen.add(case_id)
    if usd is None:
        raise UsageError("a paid run needs --allowance <usd> (the campaign's remaining allowance)")
    return Plan(mode="run", cases=tuple(cases), allowance_usd=usd, judge_mode=judge_mode or "batch")


def _allowance(value: str) -> float:
    try:
        return budget.parse_allowance(value)
    except budget.BudgetBlockedError as error:
        raise UsageError(str(error)) from error


# --- Planning the spend ---------------------------------------------------------------------


#: Upper bound of one direct judge call before the answer exists: the full output cap plus a
#: generous input (instructions, question, the whole fixture as evidence and a long answer), all
#: of it priced as a 1-hour cache write.
JUDGE_DIRECT_CALL_RESERVATION_USD = (
    8_000 * rubric.JUDGE_PRICE_INPUT * rubric.JUDGE_CACHE_WRITE_1H
    + rubric.JUDGE_MAX_TOKENS * rubric.JUDGE_PRICE_OUTPUT
) / 1_000_000
#: The same bound for a batched judge request (the default): the batch discount applies to every
#: token of it, cache writes included.
JUDGE_CALL_RESERVATION_USD = JUDGE_DIRECT_CALL_RESERVATION_USD * rubric.JUDGE_BATCH_DISCOUNT


def judge_call_reservation_usd(judge_mode: str) -> float:
    """The planning bound of one judge call in `judge_mode` ("batch" or "direct")."""
    if judge_mode == "direct":
        return JUDGE_DIRECT_CALL_RESERVATION_USD
    return JUDGE_CALL_RESERVATION_USD


def repeats_for(candidate: str | None) -> int:
    """Independent repeats per case: 1 in a Main-model comparison, `REPEATS` in every other run."""
    return REPEATS if candidate is None else comparison.COMPARISON_REPEATS


def execution_usd_for(candidate: str | None) -> float:
    """One case-run's cost allowance: the agent's default, or the candidate's in a comparison."""
    if candidate is None:
        return budget.SUBJECT_EXECUTION_USD
    return comparison.execution_limits(candidate).max_cost_usd


def reservation(
    cases: Sequence[str],
    *,
    repeats: int = REPEATS,
    execution_usd: float = budget.SUBJECT_EXECUTION_USD,
    judge_mode: str = "batch",
) -> float:
    """What a run of `cases` may cost at most: subject executions plus judge calls."""
    runs = len(cases) * repeats
    judged = sum(repeats for case_id in cases if CASES[case_id].expectation.judged)
    return runs * execution_usd + judged * judge_call_reservation_usd(judge_mode)


def suggested_slices(
    candidate: str, cases: Sequence[str] | None = None, *, judge_mode: str = "batch"
) -> tuple[tuple[str, ...], ...]:
    """The comparison subset (or `cases`) cut in order into slices whose reservation each stays
    within the per-run limit; one slice when the whole run fits."""
    execution_usd = execution_usd_for(candidate)
    pieces: list[tuple[str, ...]] = []
    current: list[str] = []
    for case_id in cases if cases is not None else comparison.subset_ids():
        grown = [*current, case_id]
        if current and (
            reservation(grown, repeats=1, execution_usd=execution_usd, judge_mode=judge_mode)
            > comparison.PER_RUN_LIMIT_USD + 1e-12
        ):
            pieces.append(tuple(current))
            grown = [case_id]
        current = grown
    if current:
        pieces.append(tuple(current))
    return tuple(pieces)


# --- The fictional test API -----------------------------------------------------------------


@dataclass
class RunningApi:
    url: str
    process: asyncio.subprocess.Process
    lines: list[str] = field(default_factory=list)


@contextlib.asynccontextmanager
async def start_api(scratch: Path) -> AsyncIterator[RunningApi]:
    """Serves the API on a temporary database seeded from the fixture; stops and drops it after."""
    env = {
        **os.environ,
        "API_PORT": "0",
        "API_WEB_INVALIDATION_URL": "",
        "API_WEB_INVALIDATION_SECRET": "",
        "API_E2E_KEY_FILE": "",
        "API_E2E_KEYS_FILE": "",
        "API_E2E_STORAGE_ROOT": str(scratch / "storage"),
    }
    flags = [f"--env-file-if-exists={name}" for name in API_ENV_FILES]
    node = shutil.which("node")
    if node is None:
        raise RuntimeError("node is not on PATH")
    process = await asyncio.create_subprocess_exec(
        node,
        *flags,
        "--import",
        "tsx",
        "src/cli/e2e-server.ts",
        str(FIXTURE_FOLDER),
        cwd=API_FOLDER,
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    try:
        url = await asyncio.wait_for(_ready(process), timeout=60)
        yield RunningApi(url=url, process=process)
    finally:
        if process.returncode is None:
            process.send_signal(signal.SIGTERM)
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(process.wait(), timeout=30)
        if process.returncode is None:
            process.kill()
            await process.wait()


async def _ready(process: asyncio.subprocess.Process) -> str:
    assert process.stdout is not None
    while True:
        line = await process.stdout.readline()
        if not line:
            errors = b""
            if process.stderr is not None:
                errors = await process.stderr.read()
            raise RuntimeError(f"the test API did not start: {errors.decode()[-500:]}")
        match = READY.search(line.decode())
        if match:
            # Keep draining its output so the pipe never blocks the server.
            asyncio.get_running_loop().create_task(_drain(process))
            return match.group(1)


async def _drain(process: asyncio.subprocess.Process) -> None:
    streams = [stream for stream in (process.stdout, process.stderr) if stream is not None]
    await asyncio.gather(*(stream.read() for stream in streams), return_exceptions=True)


async def read_person(url: str) -> dict[str, Any]:
    """The person as the public API serves it (the S11 state check and the fixture check)."""
    from llm_agent.generated.content_api.api.default import get_person
    from llm_agent.generated.content_api.client import Client

    async with Client(base_url=url) as client:
        response = await get_person.asyncio_detailed(client=client)
    if response.status_code != 200:
        raise RuntimeError(f"GET /v1/person answered {int(response.status_code)}")
    data: dict[str, Any] = json.loads(response.content)
    return data


def check_fixture_person(person: Mapping[str, Any]) -> list[str]:
    """Differences between the served person and the fictional fixture the graders expect."""
    failures = []
    for key in ("name", "headline", "email", "location", "availability"):
        if person.get(key) != FIXTURE_PERSON.get(key):
            failures.append(f"person.{key} differs from the fixture")
    links = [
        {"label": link.get("label"), "url": link.get("url")} for link in person.get("links", [])
    ]
    if links != fixture_contact()["links"]:
        failures.append("person.links differ from the fixture")
    return failures


# --- Promptfoo ------------------------------------------------------------------------------


def promptfoo_environment(
    parent: Mapping[str, str], values: Mapping[str, str], state: Path
) -> dict[str, str]:
    """Only what pnpm, Node, Python and the provider need; Promptfoo keeps its state in `state`."""
    env = {name: parent[name] for name in INHERITED if name in parent}
    return {
        **env,
        **values,
        "PYTHONPATH": str(PACKAGE_FOLDER),
        "PROMPTFOO_PYTHON": sys.executable,
        "PROMPTFOO_CONFIG_DIR": str(state),
        "PROMPTFOO_LOG_DIR": str(state / "logs"),
        "PROMPTFOO_DISABLE_TELEMETRY": "1",
        "PROMPTFOO_DISABLE_SHARING": "1",
        "PROMPTFOO_DISABLE_UPDATE": "1",
    }


def promptfoo_values(
    api_url: str, selected: Sequence[str], candidate: str | None
) -> dict[str, str]:
    """What the provider reads: the test API, the cases and, in a comparison, the candidate."""
    values = {"LLM_AGENT_API_URL": api_url, "LLM_AGENT_EVAL_CASES": ",".join(selected)}
    if candidate is not None:
        values[comparison.ENVIRONMENT] = candidate
    return values


def promptfoo_arguments(output: Path, *, repeats: int = REPEATS) -> list[str]:
    return [
        "dlx",
        PROMPTFOO,
        "eval",
        "--config",
        "promptfooconfig.yaml",
        "--repeat",
        str(repeats),
        "--max-concurrency",
        "3",
        "--no-cache",
        "--no-write",
        "--no-table",
        "--output",
        str(output),
    ]


async def run_promptfoo(output: Path, env: Mapping[str, str], *, repeats: int = REPEATS) -> None:
    pnpm = shutil.which("pnpm")
    if pnpm is None:
        raise RuntimeError("pnpm is not on PATH")
    process = await asyncio.create_subprocess_exec(
        pnpm,
        *promptfoo_arguments(output, repeats=repeats),
        cwd=EVALS_FOLDER,
        env=dict(env),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
    )
    code = await process.wait()
    # Promptfoo exits 100 when an assertion failed; the runner grades the records itself.
    if code not in (0, 100):
        raise RuntimeError(f"Promptfoo exited with {code}")


def records_from_report(report: Mapping[str, Any]) -> tuple[list[dict[str, Any]], list[str]]:
    """The provider records of Promptfoo's JSON output, numbered by repeat per case."""
    results = report.get("results", {}).get("results", [])
    records: list[dict[str, Any]] = []
    errors: list[str] = []
    counts: dict[str, int] = {}
    for result in results if isinstance(results, list) else []:
        case_id = str(result.get("vars", {}).get("case_id", ""))
        counts[case_id] = counts.get(case_id, 0) + 1
        output = (result.get("response") or {}).get("output")
        try:
            record = json.loads(output) if isinstance(output, str) else None
        except ValueError:
            record = None
        if not isinstance(record, dict) or record.get("case_id") != case_id:
            errors.append(f"{case_id} repeat {counts[case_id]}: no record ({result.get('error')})")
            continue
        record["repeat"] = counts[case_id]
        records.append(record)
    return records, errors


def secrets_of(env: Mapping[str, str]) -> list[str]:
    """Values that must never appear in an answer or a report."""
    names = ("ANTHROPIC_API_KEY", "DATABASE_PASSWORD", "POSTGRES_PASSWORD", "API_KEY_PEPPER")
    return [env[name] for name in names if len(env.get(name, "")) >= 8]


def scan_and_remove(paths: Sequence[Path], secrets: Sequence[str]) -> list[Path]:
    """Reports every file under `paths` that contains a secret and removes all of them."""
    leaked: list[Path] = []
    try:
        for path in paths:
            files = [path] if path.is_file() else [p for p in path.rglob("*") if p.is_file()]
            for file in files:
                text = file.read_text(encoding="utf-8", errors="replace")
                if any(secret in text for secret in secrets):
                    leaked.append(file)
    finally:
        for path in paths:
            if path.is_dir():
                shutil.rmtree(path, ignore_errors=True)
            else:
                path.unlink(missing_ok=True)
    return leaked


# --- Grading --------------------------------------------------------------------------------


def current_subject_versions() -> dict[str, Any]:
    from llm_agent import versions

    dumped: dict[str, Any] = versions().model_dump(mode="json")
    return dumped


def compatible_record(record: Mapping[str, Any], subject: Mapping[str, Any]) -> str | None:
    """Why a stored record cannot be regraded with the current dataset and agent, or None.

    A comparison answer (`comparison.mark`) is always refused: it was produced with another Main
    stage and 1 repeat and never enters an issue or gate pool.
    """
    marked = record.get("comparison")
    if marked is not None:
        name = marked.get("candidate") if isinstance(marked, Mapping) else None
        return f"a comparison answer of {name}; comparison answers never enter a gate pool"
    fingerprint = record.get("fingerprint")
    if not isinstance(fingerprint, dict):
        return "no fingerprint"
    if (
        record.get("record_schema") != RECORD_SCHEMA
        or fingerprint.get("record_schema") != RECORD_SCHEMA
    ):
        return "another record schema"
    if fingerprint.get("dataset_version") != DATASET_VERSION:
        return f"dataset {fingerprint.get('dataset_version')}, now {DATASET_VERSION}"
    if fingerprint.get("subject") != subject:
        return "another agent version"
    case_id = str(record.get("case_id"))
    entry = CATALOGUE.get(case_id)
    if entry is None or entry.status != "implemented" or case_id not in CASES:
        return f"{case_id} is not an implemented case"
    return None


@dataclass
class Graded:
    run: CaseRun
    report: dict[str, Any]


async def grade_record(
    record: dict[str, Any],
    *,
    judge_model: rubric.JudgeModel | None,
    allowance: budget.Allowance | None,
) -> Graded:
    """Code-grades one record and applies the rubric to judged cases (reusing compatible verdicts).

    A missing or incompatible judgement is bought only when `judge_model` is given; the call is
    reserved first and its measured (or, when unknown, reserved) cost is charged. The verdict is
    stored on the record under `judgement`.
    """
    case = CASES[str(record["case_id"])]
    entry = CATALOGUE[case.id]
    repeat = int(record["repeat"])
    code = grade_code(case, record, critical=entry.critical)
    failures = list(code.failures)
    useful: bool | None = None
    ungraded = False
    cited = supported = 0
    judge_cost = 0.0
    if case.expectation.judged:
        payload = rubric.judge_input(case, record)
        stored = record.get("judgement")
        if not (isinstance(stored, dict) and rubric.compatible(stored, payload)):
            stored = None
            if judge_model is not None and allowance is not None:
                reserved = rubric.reservation_usd(case, record)
                allowance.require(reserved, f"judging {case.id} repeat {repeat}")
                try:
                    judgement = await rubric.judge(judge_model, case, record, reserved_usd=reserved)
                except rubric.JudgeFailedError as error:
                    allowance.charge(reserved, f"judge {case.id}#{repeat}", uncertain=True)
                    failures.append(str(error))
                except Exception as error:  # a failed paid call still consumes its reservation
                    allowance.charge(reserved, f"judge {case.id}#{repeat}", uncertain=True)
                    failures.append(f"judge call failed: {type(error).__name__}")
                else:
                    allowance.charge(judgement.cost_usd, f"judge {case.id}#{repeat}")
                    judge_cost = judgement.cost_usd
                    stored = judgement.stored
                    record["judgement"] = stored
        if stored is None:
            ungraded = True
            failures.append("no compatible judgement")
        else:
            verdict = rubric.JudgeVerdict.model_validate(stored["verdict"])
            grade = rubric.score(verdict, code.cited_refs)
            useful = grade.useful
            cited, supported = grade.cited, grade.supported_cited
            failures.extend(grade.reasons)
    result_value = record.get("result")
    result: dict[str, Any] = result_value if isinstance(result_value, dict) else {}
    usage_value = result.get("usage")
    usage: dict[str, Any] = usage_value if isinstance(usage_value, dict) else {}
    run = CaseRun(
        case_id=case.id,
        repeat=repeat,
        code_passed=code.passed,
        useful=useful,
        ungraded=ungraded,
        blocked=code.blocked,
        cited=cited,
        supported_cited=supported,
        failures=tuple(failures),
    )
    passed = code.passed and (not case.expectation.judged or useful is True)
    report = {
        "case": case.id,
        "repeat": repeat,
        "pass": passed,
        "failures": failures,
        "outcome": result.get("outcome"),
        "reason": result.get("reason"),
        "tools": [
            span.get("name")
            for span in result.get("trace", [])
            if str(span.get("name", "")).startswith("tool.")
        ],
        "latency_ms": record.get("latency_ms"),
        "usage": usage,
        "judge_cost_usd": round(judge_cost, 6),
    }
    return Graded(run=run, report=report)


#: The case-runs of one chunk after the early chunk. Each chunk is reserved just before it starts,
#: so a run needs only one chunk's reservation free at a time (owner decision, issue #183).
CHUNK_CASE_RUNS = 12


def chunks(cases: Sequence[str], *, repeats: int) -> tuple[tuple[str, ...], ...]:
    """`cases` as the early chunk (the cases of the first `anomaly.EARLY_CASE_RUNS` case-runs),
    then bounded chunks of at most `CHUNK_CASE_RUNS` case-runs (at least one case each)."""
    early = max(1, math.ceil(anomaly.EARLY_CASE_RUNS / repeats))
    size = max(1, CHUNK_CASE_RUNS // repeats)
    pieces = [tuple(cases[:early])]
    pieces.extend(tuple(cases[start : start + size]) for start in range(early, len(cases), size))
    return tuple(pieces)


def allowance_stop(allowance: budget.Allowance, needed: float, chunk: Sequence[str]) -> str | None:
    """Why the next chunk cannot start within `allowance`, or None when its reservation fits."""
    if needed <= allowance.remaining_usd + 1e-9:
        return None
    return (
        f"allowance: the next chunk ({len(chunk)} case(s)) needs up to {needed:.4f} USD;"
        f" {max(allowance.remaining_usd, 0.0):.4f} USD remain"
    )


class _ChunkLog:
    """The per-chunk charges of one paid run, written to the ledger after every chunk."""

    def __init__(self, allowance: budget.Allowance, run_id: str) -> None:
        self.allowance = allowance
        self.run_id = run_id
        self.entries: list[dict[str, Any]] = []
        self._spent = allowance.spent_usd
        self._uncertain = allowance.uncertain_usd

    def add(self, chunk: Sequence[str], *, case_runs: int, reserved_usd: float) -> None:
        spent, uncertain = self.allowance.spent_usd, self.allowance.uncertain_usd
        self.entries.append(
            {
                "cases": list(chunk),
                "case_runs": case_runs,
                "reserved_usd": round(reserved_usd, 6),
                "spent_usd": round(spent - self._spent, 6),
                "uncertain_usd": round(uncertain - self._uncertain, 6),
            }
        )
        self._spent, self._uncertain = spent, uncertain
        self.write("running")

    def write(self, scope: str) -> None:
        budget.record_run(LEDGER, self.run_id, self.allowance, scope, chunks=self.entries)


def judge_requests(
    records: Sequence[Mapping[str, Any]], *, judge_mode: str
) -> list[judging.JudgeRequest]:
    """The judge requests `records` still need: every judged case-run without a compatible
    stored judgement."""
    requests: list[judging.JudgeRequest] = []
    for record in records:
        case = CASES[str(record["case_id"])]
        if not case.expectation.judged:
            continue
        stored = record.get("judgement")
        if isinstance(stored, dict) and rubric.compatible(stored, rubric.judge_input(case, record)):
            continue
        requests.append(judging.request(case, record, batch=judge_mode == "batch"))
    return requests


async def grade_records(
    records: Sequence[dict[str, Any]],
    *,
    judge_mode: str,
    allowance: budget.Allowance,
) -> tuple[list[Graded], int]:
    """Grades one chunk of records, buying every missing or incompatible judgement first: in one
    batch (`judge_mode` "batch") or one direct call each ("direct"). Returns the graded records and
    how many judge requests failed; a failed request leaves its case-run ungraded with the visible
    reason. Raises `BudgetBlockedError` before anything is sent when the judgements do not fit."""
    batch = judge_mode == "batch"
    requests = judge_requests(records, judge_mode=judge_mode)
    outcomes: dict[str, judging.JudgeOutcome] = {}
    if requests and batch:
        outcomes = await judging.judge_in_batch(requests, allowance)
    elif requests:
        outcomes = await judging.judge_directly(requests, allowance, model=rubric.anthropic_judge())
    by_record: dict[int, tuple[judging.JudgeRequest, judging.JudgeOutcome]] = {
        id(item.record): (item, outcomes[item.custom_id]) for item in requests
    }
    graded: list[Graded] = []
    failed = 0
    for record in records:
        bought = by_record.get(id(record))
        if bought is not None and bought[1].judgement is not None:
            record["judgement"] = bought[1].judgement.stored
        item = await grade_record(record, judge_model=None, allowance=None)
        if bought is not None:
            outcome = bought[1]
            if outcome.judgement is not None:
                item.report["judge_cost_usd"] = round(outcome.judgement.cost_usd, 6)
            elif outcome.failure is not None:
                failed += 1
                item.report["failures"].insert(0, outcome.failure)
        graded.append(item)
    return graded, failed


def subject_cost(
    record: Mapping[str, Any], *, execution_usd: float = budget.SUBJECT_EXECUTION_USD
) -> tuple[float, bool]:
    """The measured cost of one execution, or its whole reservation when unknown/uncertain."""
    result = record.get("result")
    usage = result.get("usage") if isinstance(result, dict) else None
    if not isinstance(usage, dict):
        return execution_usd, True
    cost = usage.get("cost_usd")
    if not isinstance(cost, int | float) or not math.isfinite(cost):
        return execution_usd, True
    if usage.get("cost_uncertain"):
        return max(float(cost), execution_usd), True
    return float(cost), False


# --- Summary --------------------------------------------------------------------------------


def charge_subject(
    allowance: budget.Allowance,
    records: Sequence[Mapping[str, Any]],
    selected: Sequence[str],
    *,
    repeats: int = REPEATS,
    execution_usd: float = budget.SUBJECT_EXECUTION_USD,
) -> None:
    """Charges the measured cost of each record and the whole reservation of each missing run."""
    ran = {(str(record["case_id"]), int(record["repeat"])) for record in records}
    for record in records:
        cost, uncertain = subject_cost(record, execution_usd=execution_usd)
        allowance.charge(
            cost, f"subject {record['case_id']}#{record['repeat']}", uncertain=uncertain
        )
    for case_id in selected:
        for repeat in range(1, repeats + 1):
            if (case_id, repeat) not in ran:
                allowance.charge(execution_usd, f"subject {case_id}#{repeat}", uncertain=True)


def write_summary(
    folder: Path,
    *,
    mode: str,
    graded: Sequence[Graded],
    selected: Sequence[str],
    extra_failures: Sequence[str],
    allowance: budget.Allowance | None,
    subject: Mapping[str, Any] | None,
    candidate: str | None = None,
    started: bool = True,
    pending: Sequence[str] = (),
    stopped: str | None = None,
    judge_mode: str | None = None,
) -> dict[str, Any]:
    """Writes `summary.json`. `started` is False when the run stopped before Promptfoo started
    (nothing charged); `pending` names the cases an anomaly stop left unrun, `stopped` its reason;
    `judge_mode` is how judgements were bought (None when none could be)."""
    runs = [item.run for item in graded]
    gate = evaluate_gate(runs, selected, repeats=repeats_for(candidate))
    failures = [*gate.failures, *extra_failures]
    gate_block = {**gate.as_dict(), "failures": failures}
    passed = gate.passed and not extra_failures
    latency = latency_percentiles([item.report.get("latency_ms") for item in graded])
    result: dict[str, Any] | None = None
    if candidate is not None:
        # A screening comparison is never a release gate, whatever its figures are.
        passed = False
        gate_block = {**gate_block, "pass": False, "scope": "comparison"}
        result = comparison.result(
            candidate,
            cases=selected,
            runs=runs,
            reports=[item.report for item in graded],
            gate=gate_block,
            latency=latency,
            cost_usd=None if allowance is None else allowance.spent_usd,
        )
    summary: dict[str, Any] = {
        "mode": mode,
        "at": datetime.now(UTC).isoformat(timespec="seconds"),
        "pass": passed,
        "started": started,
        "pending": list(pending),
        "stopped": stopped,
        "judge_mode": judge_mode,
        "gate": gate_block,
        "dataset_version": DATASET_VERSION,
        "expectations_version": EXPECTATIONS_VERSION,
        "subject": subject,
        "judge": {
            "model": rubric.JUDGE_MODEL,
            "effort": rubric.JUDGE_EFFORT,
            "rubric": rubric.RUBRIC_VERSION,
            "pricing": rubric.JUDGE_PRICING_VERSION,
        },
        "cost": None
        if allowance is None
        else {
            "available_usd": round(allowance.available_usd, 6),
            "spent_usd": round(allowance.spent_usd, 6),
            "uncertain_usd": round(allowance.uncertain_usd, 6),
            "remaining_usd": round(allowance.remaining_usd, 6),
        },
        "latency_ms": latency,
        "case_runs": [item.report for item in graded],
    }
    if result is not None:
        summary["comparison"] = result
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    return summary


def store_answers(folder: Path, records: Sequence[Mapping[str, Any]]) -> None:
    answers = folder / "answers"
    answers.mkdir(parents=True, exist_ok=True)
    for record in records:
        name = f"{record['case_id']}-{record['repeat']}.json"
        (answers / name).write_text(
            json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )


def load_answers(folder: Path) -> list[dict[str, Any]]:
    answers = folder / "answers"
    if not answers.is_dir():
        raise UsageError(f"{folder} has no answers/ folder")
    return [json.loads(path.read_text(encoding="utf-8")) for path in sorted(answers.glob("*.json"))]


def print_summary(summary: Mapping[str, Any], folder: Path) -> None:
    gate = summary["gate"]
    compared = summary.get("comparison")
    if compared is not None:
        verdict = "comparison (not a gate)"
    else:
        verdict = "PASS" if summary["pass"] else "FAIL"
    print(f"llm-agent evals ({summary['mode']}, scope {gate['scope']}): {verdict}")
    if compared is not None:
        runs = compared["case_runs"]
        limit = compared["execution_limit"]
        print(
            f"  {compared['candidate']}: case-runs {runs['recorded']} of {runs['expected']}"
            f" expected; limit_reached {compared['limit_reached']};"
            f" execution limit {limit['max_cost_usd']:.4f} USD"
            f" (default {limit['default_usd']:.4f})"
        )
    print(f"  critical {gate['critical']['passed']}/{gate['critical']['runs']}")
    for language in ("en", "cs"):
        useful = gate["useful"][language]
        blocking = gate["false_blocking"][language]
        citations = gate["citations"][language]
        print(
            f"  {language}: useful {useful['passed']}/{useful['runs']},"
            f" supported citations {citations['passed']}/{citations['runs']},"
            f" false blocking {blocking['passed']}/{blocking['runs']}"
        )
    latency = summary["latency_ms"]
    if latency["runs"]:
        print(
            f"  latency p50 {latency['p50']} ms, p95 {latency['p95']} ms ({latency['runs']} runs)"
        )
    if summary["cost"] is not None:
        cost = summary["cost"]
        print(
            f"  cost {cost['spent_usd']:.4f} USD (uncertain {cost['uncertain_usd']:.4f});"
            f" {cost['remaining_usd']:.4f} USD of this run's allowance remain"
        )
    for failure in gate["failures"]:
        print(f"  - {failure}")
    print(f"  report: {folder / 'summary.json'}")


# --- Commands -------------------------------------------------------------------------------


def run_folder() -> Path:
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    folder = REPORT_ROOT / f"run-{stamp}-{os.getpid()}"
    folder.mkdir(parents=True, exist_ok=False)
    return folder


async def command_check_fixture() -> int:
    REPORT_ROOT.mkdir(parents=True, exist_ok=True)
    scratch = REPORT_ROOT / f"fixture-{os.getpid()}"
    try:
        async with start_api(scratch) as api:
            failures = check_fixture_person(await read_person(api.url))
    finally:
        shutil.rmtree(scratch, ignore_errors=True)
    for failure in failures:
        print(f"fixture: {failure}")
    print("fixture: ok" if not failures else "fixture: FAILED")
    return 0 if not failures else 1


class _NotStartedError(Exception):
    """The run stopped before Promptfoo started; nothing was paid."""


async def command_run(
    selected: Sequence[str],
    declared_usd: float,
    *,
    candidate: str | None = None,
    judge_mode: str = "batch",
) -> int:
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print(
            "blocked: no model key; run through `pnpm --filter @sebela/llm-agent eval`",
            file=sys.stderr,
        )
        return BLOCKED
    allowance = budget.open_allowance(declared_usd, LEDGER)
    repeats = repeats_for(candidate)
    execution_usd = execution_usd_for(candidate)
    pieces = chunks(selected, repeats=repeats)

    def needed(chunk: Sequence[str]) -> float:
        return reservation(
            chunk, repeats=repeats, execution_usd=execution_usd, judge_mode=judge_mode
        )

    # Only the early chunk has to fit before anything starts; every later chunk is reserved
    # just before it starts.
    allowance.require(needed(pieces[0]), f"the early chunk ({len(pieces[0])} case(s)) x {repeats}")
    if candidate is not None:
        comparison.apply_main(candidate)
    folder = run_folder()
    secrets = secrets_of(os.environ)
    subject = current_subject_versions()
    log = _ChunkLog(allowance, folder.name)
    extra: list[str] = []
    stored: list[dict[str, Any]] = []
    graded: list[Graded] = []
    pending: list[str] = []
    stopped: str | None = None
    started = False
    blocked = False
    try:
        async with start_api(folder / "api") as api:
            try:
                before = await read_person(api.url)
            except Exception as error:
                raise _NotStartedError(f"{type(error).__name__}: {error}") from error
            differences = check_fixture_person(before)
            if differences:
                raise _NotStartedError("; ".join(differences))
            started = True
            for index, chunk in enumerate(pieces):
                rest = [case_id for later in pieces[index + 1 :] for case_id in later]
                reserved = needed(chunk)
                stopped = allowance_stop(allowance, reserved, chunk)
                if stopped is not None:
                    print(f"stopped: {stopped}", file=sys.stderr)
                    extra.append(f"stopped before chunk {index + 1}: {stopped}")
                    pending = [*chunk, *rest]
                    break
                records, failure, leaked = await _run_chunk(
                    folder, index, chunk, api.url, candidate, repeats=repeats, secrets=secrets
                )
                # Measured cost, or the whole reservation for every unmeasured case-run.
                charge_subject(
                    allowance, records, chunk, repeats=repeats, execution_usd=execution_usd
                )
                if leaked:
                    print(
                        "blocked: Promptfoo's output contained a credential; it was deleted",
                        file=sys.stderr,
                    )
                    blocked = True
                elif failure is not None:
                    extra.append(f"run failed: {type(failure).__name__}: {failure}")
                if any(any(s in json.dumps(record) for s in secrets) for record in records):
                    print(
                        "blocked: a record contained a credential; nothing was stored",
                        file=sys.stderr,
                    )
                    blocked = True
                    records = []
                if candidate is not None and records:
                    wrong = comparison.mismatches(candidate, records)
                    if wrong:
                        print(
                            "blocked: a record names another Main stage than the candidate;"
                            " nothing was stored",
                            file=sys.stderr,
                        )
                        extra.extend(wrong)
                        blocked = True
                        records = []
                    else:
                        comparison.mark(candidate, records)
                if blocked:
                    log.add(chunk, case_runs=len(chunk) * repeats, reserved_usd=reserved)
                    pending = rest
                    break
                try:
                    chunk_graded, judge_failures = await grade_records(
                        records, judge_mode=judge_mode, allowance=allowance
                    )
                except budget.BudgetBlockedError as error:
                    extra.append(f"blocked: {error}")
                    blocked = True
                    chunk_graded, judge_failures = (
                        [
                            await grade_record(record, judge_model=None, allowance=None)
                            for record in records
                        ],
                        0,
                    )
                stored.extend(records)
                graded.extend(chunk_graded)
                log.add(chunk, case_runs=len(chunk) * repeats, reserved_usd=reserved)
                if blocked:
                    pending = rest
                    break
                if index == 0 and rest:
                    stopped = anomaly.early_stop(
                        _outcomes(records, chunk, repeats=repeats),
                        judge_failures=judge_failures,
                        spent_usd=allowance.spent_usd,
                        uncertain_usd=allowance.uncertain_usd,
                    )
                    if stopped is not None:
                        print(f"stopped: {stopped}", file=sys.stderr)
                        extra.append(f"stopped after the early chunk: {stopped}")
                        pending = rest
                        break
            after = await read_person(api.url)
            if after != before:
                extra.append("the content API state changed during the run")
    except _NotStartedError as error:
        extra.append(f"not started: {error}")
    except Exception as error:
        if started:
            # Whatever ran is already charged; a failed fixture is a failed run, never a pass.
            extra.append(f"run failed: {type(error).__name__}: {error}")
        else:
            extra.append(f"not started: {type(error).__name__}: {error}")
    finally:
        shutil.rmtree(folder / "api", ignore_errors=True)

    if stored:
        store_answers(folder, stored)
    summary = write_summary(
        folder,
        mode="run" if candidate is None else "compare",
        graded=graded,
        selected=selected,
        extra_failures=extra,
        allowance=allowance,
        subject=subject,
        candidate=candidate,
        started=started,
        pending=pending,
        stopped=stopped,
        judge_mode=judge_mode,
    )
    log.write(summary["gate"]["scope"] if started else "not started")
    print_summary(summary, folder)
    if blocked or not started or stopped is not None:
        return BLOCKED
    if candidate is not None:
        # A comparison has no gate: it succeeds when every named case-run was recorded and graded
        # without a run failure, whatever its figures are.
        return 0 if comparison.complete(summary["comparison"]) and not extra else 1
    return 0 if summary["pass"] else 1


async def _run_chunk(
    folder: Path,
    index: int,
    chunk: Sequence[str],
    api_url: str,
    candidate: str | None,
    *,
    repeats: int,
    secrets: Sequence[str],
) -> tuple[list[dict[str, Any]], BaseException | None, list[Path]]:
    """Runs Promptfoo once for `chunk`; returns its records, the failure (if any) and the output
    files that leaked a credential (deleted)."""
    raw = folder / f"promptfoo-{index}.raw.json"
    state = folder / f"promptfoo-state-{index}"
    records: list[dict[str, Any]] = []
    failure: BaseException | None = None
    try:
        await run_promptfoo(
            raw,
            promptfoo_environment(os.environ, promptfoo_values(api_url, chunk, candidate), state),
            repeats=repeats,
        )
        report = json.loads(raw.read_text(encoding="utf-8"))
        records, errors = records_from_report(report)
        if errors:
            failure = RuntimeError("; ".join(errors))
    except Exception as error:
        failure = error
    finally:
        leaked = scan_and_remove([raw, state], secrets)
    return records, failure, leaked


def _outcomes(
    records: Sequence[Mapping[str, Any]], chunk: Sequence[str], *, repeats: int
) -> list[str | None]:
    """The outcome of every expected case-run of `chunk` in order; None when it is missing."""
    found: dict[tuple[str, int], str | None] = {}
    for record in records:
        result = record.get("result")
        outcome = result.get("outcome") if isinstance(result, dict) else None
        found[(str(record["case_id"]), int(record["repeat"]))] = (
            str(outcome) if outcome is not None else None
        )
    return [found.get((case_id, repeat)) for case_id in chunk for repeat in range(1, repeats + 1)]


async def command_regrade(
    source: Path, *, judge: bool, declared_usd: float | None, judge_mode: str = "batch"
) -> int:
    records = load_answers(source)
    subject = current_subject_versions()
    extra: list[str] = []
    usable: list[dict[str, Any]] = []
    for record in records:
        reason = compatible_record(record, subject)
        if reason is None:
            usable.append(record)
        else:
            extra.append(f"{record.get('case_id')} repeat {record.get('repeat')}: {reason}")
    selected = list(dict.fromkeys(str(record["case_id"]) for record in usable))
    allowance: budget.Allowance | None = None
    log: _ChunkLog | None = None
    folder = run_folder()
    graded: list[Graded] = []
    pending: list[str] = []
    stopped: str | None = None
    blocked = False
    if not judge:
        for record in usable:
            graded.append(await grade_record(record, judge_model=None, allowance=None))
    else:
        if not os.environ.get("ANTHROPIC_API_KEY"):
            print("blocked: no model key for --judge", file=sys.stderr)
            return BLOCKED
        assert declared_usd is not None
        allowance = budget.open_allowance(declared_usd, LEDGER)
        log = _ChunkLog(allowance, folder.name)
        pieces = chunks(selected, repeats=REPEATS)
        for index, chunk in enumerate(pieces):
            names = set(chunk)
            part = [record for record in usable if str(record["case_id"]) in names]
            rest = [case_id for later in pieces[index + 1 :] for case_id in later]
            # Each chunk's judge requests are reserved just before they are sent.
            reserved = sum(
                item.reserved_usd for item in judge_requests(part, judge_mode=judge_mode)
            )
            stopped = allowance_stop(allowance, reserved, chunk)
            if stopped is not None:
                print(f"stopped: {stopped}", file=sys.stderr)
                extra.append(f"stopped before chunk {index + 1}: {stopped}")
                pending = [*chunk, *rest]
                break
            try:
                chunk_graded, judge_failures = await grade_records(
                    part, judge_mode=judge_mode, allowance=allowance
                )
            except budget.BudgetBlockedError as error:
                extra.append(f"blocked: {error}")
                blocked = True
                pending = rest
                for record in part:
                    graded.append(await grade_record(record, judge_model=None, allowance=None))
                break
            graded.extend(chunk_graded)
            log.add(chunk, case_runs=len(part), reserved_usd=reserved)
            if index == 0 and rest:
                stopped = anomaly.early_stop(
                    [],
                    judge_failures=judge_failures,
                    spent_usd=allowance.spent_usd,
                    uncertain_usd=allowance.uncertain_usd,
                )
                if stopped is not None:
                    print(f"stopped: {stopped}", file=sys.stderr)
                    extra.append(f"stopped after the early chunk: {stopped}")
                    pending = rest
                    break
    store_answers(folder, usable)
    summary = write_summary(
        folder,
        mode="regrade-judge" if judge else "regrade",
        graded=graded,
        selected=selected,
        extra_failures=extra,
        allowance=allowance,
        subject=subject,
        pending=pending,
        stopped=stopped,
        judge_mode=judge_mode if judge else None,
    )
    if log is not None:
        log.write(summary["gate"]["scope"])
    print_summary(summary, folder)
    if blocked or stopped is not None:
        return BLOCKED
    return 0 if summary["pass"] else 1


def command_compare_report(folders: Sequence[Path]) -> int:
    """Prints stored comparison summaries side by side; reads files only (free)."""
    summaries: list[dict[str, Any]] = []
    for folder in folders:
        path = folder / "summary.json"
        if not path.is_file():
            raise UsageError(f"{folder} has no summary.json")
        try:
            summaries.append(json.loads(path.read_text(encoding="utf-8")))
        except ValueError as error:
            raise UsageError(f"{path} is not a JSON summary: {error}") from error
    try:
        lines = comparison.side_by_side(summaries)
    except ValueError as error:
        raise UsageError(str(error)) from error
    print("\n".join(lines))
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    try:
        chosen = plan(sys.argv[1:] if argv is None else argv)
    except UsageError as error:
        print(f"usage: {error}", file=sys.stderr)
        return BLOCKED
    try:
        if chosen.mode == "check-fixture":
            return asyncio.run(command_check_fixture())
        if chosen.mode == "regrade":
            assert chosen.regrade is not None
            return asyncio.run(
                command_regrade(
                    chosen.regrade,
                    judge=chosen.judge,
                    declared_usd=chosen.allowance_usd,
                    judge_mode=chosen.judge_mode,
                )
            )
        if chosen.mode == "compare-report":
            return command_compare_report(chosen.folders)
        assert chosen.allowance_usd is not None
        return asyncio.run(
            command_run(
                chosen.cases,
                chosen.allowance_usd,
                candidate=chosen.candidate,
                judge_mode=chosen.judge_mode,
            )
        )
    except (budget.BudgetBlockedError, UsageError) as error:
        print(f"blocked: {error}", file=sys.stderr)
        return BLOCKED


if __name__ == "__main__":
    sys.exit(main())
