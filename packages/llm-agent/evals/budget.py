"""The eval-campaign allowance: one ceiling per phase campaign, never granted anew.

Every phase has its own campaign with its own ceiling and its own part of the ledger
(`CAMPAIGNS`; `docs/decisions/0026-eval-cost-controls-for-later-phases.md`, point 7), so one phase
cannot spend another's acceptance run. A paid run names its campaign (`--campaign`, or the
environment variable `SEBELA_EVAL_CAMPAIGN`) and its stage (`--stage issue`, the default, or
`--stage phase-pr` for the full run at the phase pull request). A run that names no campaign, an
unknown one or two different ones is a block: there is no default campaign and no fallback to a
larger ceiling.

A paid run also states the campaign's remaining allowance it was given (`--allowance`, carried
forward from the last issue/phase report or the workflow's declared remaining allowance). The run
may use the smallest of: that, what this checkout's ledger leaves of the campaign's ceiling and,
for an issue run, what the ledger leaves of the campaign's cumulative stop for issue runs and the
per-run stop. Repeating runs in one worktree therefore cannot re-grant spent money. A run is
reserved chunk by chunk, each bounded chunk just before it starts: every subject execution at its
full execution allowance, every judge call at its upper bound. A missing allowance, a ceiling
overrun or an exhausted allowance is a visible block, never a pass.

Spend that cannot be measured (a crashed or cancelled execution, a missing usage report) consumes
its whole reservation.
"""

from __future__ import annotations

import contextlib
import json
import math
import os
import threading
from collections.abc import Iterator, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from types import MappingProxyType
from typing import Any, Final

#: The subject's own allowance per execution (the agent enforces it; `AgentConfig`).
SUBJECT_EXECUTION_USD = 0.02
#: The environment variable that names the campaign of every paid run started under it.
CAMPAIGN_ENVIRONMENT: Final = "SEBELA_EVAL_CAMPAIGN"
#: What a paid run is for: `issue` (work on an issue, bound by the campaign's stops for issue
#: runs) or `phase-pr` (the full run at the phase pull request and its affected rerun).
STAGES: Final = ("issue", "phase-pr")
#: The environment variable with which the phase loop names the record of the paid runs it has
#: seen in every checkout (`harness/steward.mjs`, `.worktrees/logs/<phase>/eval-spend.json`).
KEPT_RUNS_ENVIRONMENT: Final = "SEBELA_EVAL_KEPT_RUNS"
#: What the loop calls the main checkout in that record; a worktree is called by its folder.
MAIN_CHECKOUT: Final = "the main checkout"
#: The campaign of ledger entries written before campaigns were named.
LEGACY_CAMPAIGN: Final = "06-llm-agent"


class BudgetBlockedError(Exception):
    """The run cannot start or continue within its allowance."""


@dataclass(frozen=True)
class Campaign:
    """One phase's eval campaign, named after its phase folder."""

    name: str
    #: Everything the campaign may spend: subject, judge, retries, cache and uncertain usage.
    ceiling_usd: float
    #: Where issue runs stop cumulatively, leaving the rest for the phase-PR run (None: no stop).
    issue_stop_usd: float | None = None
    #: What one issue run may spend (None: no stop). The phase-PR run is not bound by it.
    run_stop_usd: float | None = None


def _load_campaigns(path: Path) -> Mapping[str, Campaign]:
    data: dict[str, dict[str, float | None]] = json.loads(path.read_text(encoding="utf-8"))
    return MappingProxyType(
        {
            name: Campaign(
                name,
                ceiling_usd=float(entry["ceiling_usd"] or 0.0),
                issue_stop_usd=entry["issue_stop_usd"],
                run_stop_usd=entry["run_stop_usd"],
            )
            for name, entry in data.items()
        }
    )


#: The owner-approved campaigns, in `campaigns.json` beside this module, which the phase loop's
#: steward reads too (`harness/lib/spend.mjs`). Phase 6 is finished and keeps the ceiling the
#: owner set for it (USD 10 raised to USD 13 in issue #183) and the rules it ran under; phases 7,
#: 7.1 and 8 follow decision 0026, point 7. A new phase gets its campaign there when its budget
#: is approved; a campaign without a positive ceiling can spend nothing.
CAMPAIGNS: Final[Mapping[str, Campaign]] = _load_campaigns(
    Path(__file__).with_name("campaigns.json")
)


def campaign(name: str | None) -> Campaign:
    """The campaign called `name`; an unknown or missing name is a block, never a default."""
    found = CAMPAIGNS.get(name) if name else None
    if found is None:
        known = ", ".join(CAMPAIGNS)
        if not name:
            raise BudgetBlockedError(
                f"a paid run names no campaign; name one with --campaign or"
                f" {CAMPAIGN_ENVIRONMENT} (one of {known})"
            )
        raise BudgetBlockedError(f"unknown campaign {name} (one of {known})")
    return found


def named_campaign(option: str | None, env: Mapping[str, str]) -> Campaign:
    """The campaign a run names with `--campaign` or the environment. Both may name it, but not
    differently: the run would otherwise silently pick one ceiling over another."""
    from_env = env.get(CAMPAIGN_ENVIRONMENT, "").strip() or None
    if option is not None and from_env is not None and option != from_env:
        raise BudgetBlockedError(
            f"--campaign {option} differs from {CAMPAIGN_ENVIRONMENT}={from_env}"
        )
    return campaign(option if option is not None else from_env)


@dataclass
class Allowance:
    """What one run may still spend; reservations are taken before every paid call."""

    available_usd: float
    spent_usd: float = 0.0
    uncertain_usd: float = 0.0
    entries: list[dict[str, Any]] = field(default_factory=list)
    #: The campaign and stage the run was opened in (`open_allowance`); None for an allowance
    #: built by hand, which the ledger refuses.
    campaign: Campaign | None = None
    stage: str | None = None
    #: What the ledger left of the campaign's ceiling when the run was opened.
    campaign_remaining_at_open_usd: float = 0.0

    def require(self, usd: float, purpose: str) -> None:
        if usd > self.remaining_usd + 1e-12:
            raise BudgetBlockedError(
                f"{purpose} needs up to {usd:.4f} USD; {self.remaining_usd:.4f} USD remain"
            )

    def charge(self, usd: float, purpose: str, *, uncertain: bool = False) -> None:
        self.spent_usd += usd
        if uncertain:
            self.uncertain_usd += usd
        self.entries.append({"purpose": purpose, "usd": round(usd, 6), "uncertain": uncertain})

    @property
    def remaining_usd(self) -> float:
        return max(0.0, self.available_usd - self.spent_usd)

    @property
    def campaign_remaining_usd(self) -> float:
        """What is left of the campaign's ceiling after this run's spend so far."""
        return max(0.0, self.campaign_remaining_at_open_usd - self.spent_usd)


def parse_allowance(value: str, of: Campaign) -> float:
    try:
        usd = float(value)
    except ValueError as error:
        raise BudgetBlockedError(f"--allowance {value!r} is not an amount in USD") from error
    if not math.isfinite(usd) or usd <= 0:
        raise BudgetBlockedError("--allowance must be a positive amount in USD")
    if usd > of.ceiling_usd:
        raise BudgetBlockedError(
            f"--allowance {usd} exceeds the {of.ceiling_usd:.2f} USD ceiling of the {of.name}"
            " campaign"
        )
    return usd


@dataclass(frozen=True)
class KeptRuns:
    """The phase loop's record of the paid runs of every checkout, and what the loop calls this
    checkout in it (`source`). A worktree has its own ledger, so without this record every issue
    worktree would start with a fresh cumulative stop for issue runs."""

    path: Path
    source: str


def kept_runs(env: Mapping[str, str], checkout: Path) -> KeptRuns | None:
    """The loop's kept record when the environment names one (`SEBELA_EVAL_KEPT_RUNS`, set by
    `harness/run-phase.mjs`), for the checkout at `checkout`; None outside the loop."""
    path = env.get(KEPT_RUNS_ENVIRONMENT, "").strip()
    if not path:
        return None
    source = checkout.name if checkout.parent.name == ".worktrees" else MAIN_CHECKOUT
    return KeptRuns(Path(path), source=source)


def _kept_spent(kept: KeptRuns, name: str, stage: str | None, local: frozenset[str]) -> float:
    """What the loop's record counts for the campaign beyond this checkout's own ledger: the
    runs of the other checkouts, and the runs of an earlier worktree in this folder that the
    ledger no longer holds. A run whose id is in the ledger (`local`) is read from there, which
    is newer. A record that does not exist yet adds nothing; one that cannot be read is a block,
    never zero."""
    if not kept.path.exists():
        return 0.0
    try:
        data = json.loads(kept.path.read_text(encoding="utf-8"))
        runs = data["runs"]
        total = 0.0
        for entry in runs:
            source, run, spent = entry["source"], entry["run"], float(entry["spentUsd"])
            if entry.get("campaign") != name:
                continue
            if source == kept.source and run in local:
                continue
            if stage is not None and entry.get("stage") != stage:
                continue
            total += spent
    except (OSError, ValueError, TypeError, KeyError, AttributeError) as error:
        raise BudgetBlockedError(
            f"the phase loop's kept record of paid runs ({kept.path.name}) cannot be read;"
            " spend in other worktrees is unknown, so no paid run starts"
        ) from error
    if not math.isfinite(total):
        raise BudgetBlockedError(
            f"the phase loop's kept record of paid runs ({kept.path.name}) holds no valid amounts"
        )
    return total


def _campaign_of(entry: Mapping[str, Any]) -> str:
    return str(entry.get("campaign") or LEGACY_CAMPAIGN)


def ledger_spent(
    ledger: Path, name: str, *, stage: str | None = None, kept: KeptRuns | None = None
) -> float:
    """What the ledger counts as spent in the campaign `name` (of one stage when given), plus,
    in the phase loop, what the loop's kept record counts beyond this ledger (`kept`).
    Entries written before campaigns were named belong to phase 6."""
    runs: list[dict[str, Any]] = []
    if ledger.exists():
        runs = json.loads(ledger.read_text(encoding="utf-8")).get("runs", [])
    local = frozenset(str(entry.get("run")) for entry in runs)
    elsewhere = _kept_spent(kept, name, stage, local) if kept is not None else 0.0
    return elsewhere + float(
        sum(
            float(entry.get("spent_usd", 0))
            for entry in runs
            if _campaign_of(entry) == name and (stage is None or entry.get("stage") == stage)
        )
    )


def open_allowance(
    declared_usd: float,
    ledger: Path,
    of: Campaign,
    stage: str,
    *,
    kept: KeptRuns | None = None,
) -> Allowance:
    """The allowance of one run in the campaign `of`: the declared remainder, capped by what this
    checkout's ledger leaves of the campaign's ceiling and, for an issue run, of the cumulative
    stop for issue runs, and by the per-run stop. Each exhausted bound is a block that names it.

    This checkout's ledger knows only its own runs. In the phase loop `kept` adds the runs the
    loop has seen in every other checkout, so the ceiling and the cumulative stop for issue runs
    hold across the issue worktrees; outside the loop they hold per checkout, and the declared
    allowance carries the remainder."""
    if stage not in STAGES:
        raise BudgetBlockedError(f"the stage of a paid run is {' or '.join(STAGES)}, not {stage!r}")
    campaign_remaining = of.ceiling_usd - ledger_spent(ledger, of.name, kept=kept)
    if campaign_remaining <= 0:
        raise BudgetBlockedError(
            f"the {of.name} campaign's {of.ceiling_usd:.2f} USD ceiling is exhausted; its coverage"
            " stays pending until the owner grants an explicit increase"
        )
    available = min(declared_usd, campaign_remaining)
    if stage == "issue":
        if of.issue_stop_usd is not None:
            issue_remaining = of.issue_stop_usd - ledger_spent(
                ledger, of.name, stage="issue", kept=kept
            )
            if issue_remaining <= 0:
                raise BudgetBlockedError(
                    f"the issue runs of the {of.name} campaign reached their cumulative"
                    f" {of.issue_stop_usd:.2f} USD stop; the rest of the ceiling is kept for the"
                    " phase-PR run (--stage phase-pr), so this coverage stays pending"
                )
            available = min(available, issue_remaining)
        if of.run_stop_usd is not None:
            available = min(available, of.run_stop_usd)
    if available <= 0:
        raise BudgetBlockedError(
            f"the declared allowance of the {of.name} campaign is exhausted; ask for an explicit"
            " increase"
        )
    return Allowance(
        available_usd=available,
        campaign=of,
        stage=stage,
        campaign_remaining_at_open_usd=campaign_remaining,
    )


def spend_line(allowance: Allowance, *, expected_usd: float, finished: bool = False) -> str:
    """The spend line of a paid run for its report and issue comment: the expected cost before
    the run, the actual cost after it and what remains of the campaign's ceiling."""
    of = allowance.campaign
    if of is None:
        raise BudgetBlockedError("an allowance without a campaign has no spend line")
    remainder = (
        f"{allowance.campaign_remaining_usd:.4f} USD of the {of.name} ceiling"
        f" ({of.ceiling_usd:.2f} USD) remain"
    )
    if not finished:
        return f"spend: expected {expected_usd:.4f} USD before the run; {remainder}"
    return (
        f"spend: expected {expected_usd:.4f} USD, actual {allowance.spent_usd:.4f} USD"
        f" (uncertain {allowance.uncertain_usd:.4f}); {remainder}"
    )


def record_run(
    ledger: Path,
    run_id: str,
    allowance: Allowance,
    scope: str,
    *,
    chunks: list[dict[str, Any]] | None = None,
    provisional_usd: float = 0.0,
    expected_usd: float | None = None,
) -> None:
    """Writes `run_id`'s entry: what `allowance` has spent so far and, when given, the charges of
    every chunk. A later write replaces the earlier one, so the ledger counts each run once.

    A run writes its entry before every chunk with that chunk's reservation as `provisional_usd`,
    counted as spent and uncertain, and again after the chunk with what it measured instead. An
    interrupted run therefore leaves an entry that counts its unfinished chunk at its whole
    reservation: unmeasured spend consumes its reservation, also when the process is killed.

    The entry names the allowance's campaign and stage, which decide whose ceiling and stops it
    counts against, and the run's expected cost when given (for the spend line of a report)."""
    if allowance.campaign is None or allowance.stage is None:
        raise BudgetBlockedError(
            "a run without a named campaign and stage cannot be recorded in the ledger"
        )
    entry: dict[str, Any] = {
        "run": run_id,
        "at": datetime.now(UTC).isoformat(timespec="seconds"),
        "campaign": allowance.campaign.name,
        "stage": allowance.stage,
        "scope": scope,
        "spent_usd": round(allowance.spent_usd + provisional_usd, 6),
        "uncertain_usd": round(allowance.uncertain_usd + provisional_usd, 6),
    }
    if provisional_usd > 0:
        entry["provisional_usd"] = round(provisional_usd, 6)
    if expected_usd is not None:
        entry["expected_usd"] = round(expected_usd, 6)
    if chunks is not None:
        entry["chunks"] = chunks
    ledger.parent.mkdir(parents=True, exist_ok=True)
    # Two runs in one checkout write the same ledger. Reading it, replacing this run's entry and
    # writing it back happens under a lock and lands in one step, so neither loses the other's
    # entry. (They can still both open their allowance from the same remainder: run paid evals
    # one at a time per checkout.)
    with _locked(ledger):
        data: dict[str, Any] = {"runs": []}
        if ledger.exists():
            data = json.loads(ledger.read_text(encoding="utf-8"))
        data["runs"] = [run for run in data["runs"] if run.get("run") != run_id] + [entry]
        scratch = ledger.with_name(f"{ledger.name}.{os.getpid()}.{threading.get_ident()}.tmp")
        scratch.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
        os.replace(scratch, ledger)


@contextlib.contextmanager
def _locked(ledger: Path) -> Iterator[None]:
    """Holds the ledger's lock file for one read-modify-write. Where the platform has no
    advisory file locks the write goes unlocked, as before."""
    try:
        import fcntl
    except ImportError:  # pragma: no cover - not on the platforms the evals run on
        yield
        return
    with ledger.with_name(f"{ledger.name}.lock").open("w") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)
