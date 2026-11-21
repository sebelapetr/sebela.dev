"""The eval-campaign allowance: one cumulative USD 10 ceiling, never granted anew.

A paid run states the campaign's remaining allowance it was given (`--allowance`, carried forward
from the last issue/phase report or the workflow's declared remaining allowance). The run may use
the smaller of that and what this checkout's local ledger leaves of the ceiling, so repeating runs
in one worktree cannot re-grant spent money. Batches are reserved before they start: every
subject execution at its full execution allowance, every judge call at its upper bound. A missing
allowance, a ceiling overrun or an exhausted allowance is a visible block, never a pass.

Spend that cannot be measured (a crashed or cancelled execution, a missing usage report) consumes
its whole reservation.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

#: The owner-approved initial campaign ceiling (`.plan/done/06-llm-agent/evals.md`).
CAMPAIGN_CEILING_USD = 10.0
#: The subject's own allowance per execution (the agent enforces it; `AgentConfig`).
SUBJECT_EXECUTION_USD = 0.02


class BudgetBlockedError(Exception):
    """The run cannot start or continue within its allowance."""


@dataclass
class Allowance:
    """What one run may still spend; reservations are taken before every paid call."""

    available_usd: float
    spent_usd: float = 0.0
    uncertain_usd: float = 0.0
    entries: list[dict[str, Any]] = field(default_factory=list)

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


def parse_allowance(value: str) -> float:
    try:
        usd = float(value)
    except ValueError as error:
        raise BudgetBlockedError(f"--allowance {value!r} is not an amount in USD") from error
    if not math.isfinite(usd) or usd <= 0:
        raise BudgetBlockedError("--allowance must be a positive amount in USD")
    if usd > CAMPAIGN_CEILING_USD:
        raise BudgetBlockedError(
            f"--allowance {usd} exceeds the {CAMPAIGN_CEILING_USD} USD campaign ceiling"
        )
    return usd


def ledger_spent(ledger: Path) -> float:
    if not ledger.exists():
        return 0.0
    data = json.loads(ledger.read_text(encoding="utf-8"))
    return float(sum(float(entry.get("spent_usd", 0)) for entry in data.get("runs", [])))


def open_allowance(declared_usd: float, ledger: Path) -> Allowance:
    """The allowance of one run: the declared remainder, capped by this checkout's ledger."""
    local_remaining = CAMPAIGN_CEILING_USD - ledger_spent(ledger)
    available = min(declared_usd, local_remaining)
    if available <= 0:
        raise BudgetBlockedError(
            "the campaign allowance is exhausted; ask for an explicit increase"
        )
    return Allowance(available_usd=available)


def record_run(ledger: Path, run_id: str, allowance: Allowance, scope: str) -> None:
    data: dict[str, Any] = {"runs": []}
    if ledger.exists():
        data = json.loads(ledger.read_text(encoding="utf-8"))
    data["runs"].append(
        {
            "run": run_id,
            "at": datetime.now(UTC).isoformat(timespec="seconds"),
            "scope": scope,
            "spent_usd": round(allowance.spent_usd, 6),
            "uncertain_usd": round(allowance.uncertain_usd, 6),
        }
    )
    ledger.parent.mkdir(parents=True, exist_ok=True)
    ledger.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
