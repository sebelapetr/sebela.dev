"""The cumulative campaign allowance: declared remainder, local ledger cap and reservations."""

from __future__ import annotations

from pathlib import Path

import pytest

from evals import budget


@pytest.mark.parametrize("value", ["0", "-1", "nan", "inf", "ten", "10.01"])
def test_an_invalid_or_over_ceiling_allowance_is_refused(value: str) -> None:
    with pytest.raises(budget.BudgetBlockedError):
        budget.parse_allowance(value)


def test_the_ledger_caps_what_a_declared_allowance_grants(tmp_path: Path) -> None:
    ledger = tmp_path / "ledger.json"
    first = budget.open_allowance(10.0, ledger)
    first.charge(9.5, "earlier run")
    budget.record_run(ledger, "run-1", first, "partial")
    second = budget.open_allowance(10.0, ledger)
    assert second.available_usd == pytest.approx(0.5)


def test_an_exhausted_campaign_blocks(tmp_path: Path) -> None:
    ledger = tmp_path / "ledger.json"
    spent = budget.open_allowance(10.0, ledger)
    spent.charge(10.0, "everything")
    budget.record_run(ledger, "run-1", spent, "partial")
    with pytest.raises(budget.BudgetBlockedError):
        budget.open_allowance(5.0, ledger)


def test_a_reservation_over_the_remainder_blocks_and_uncertain_spend_is_tracked() -> None:
    allowance = budget.Allowance(available_usd=1.0)
    allowance.require(1.0, "fits")
    allowance.charge(0.4, "measured")
    allowance.charge(0.02, "crashed", uncertain=True)
    assert allowance.uncertain_usd == pytest.approx(0.02)
    with pytest.raises(budget.BudgetBlockedError):
        allowance.require(0.6, "too much")
