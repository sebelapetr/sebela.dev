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


def test_a_run_rewrites_its_own_ledger_entry_with_every_chunk(tmp_path: Path) -> None:
    ledger = tmp_path / "ledger.json"
    allowance = budget.open_allowance(5.0, ledger)
    allowance.charge(0.3, "chunk 1")
    chunks = [{"cases": ["a"], "reserved_usd": 0.5, "spent_usd": 0.3, "uncertain_usd": 0.0}]
    budget.record_run(ledger, "run-1", allowance, "running", chunks=chunks)
    allowance.charge(0.2, "chunk 2")
    chunks.append({"cases": ["b"], "reserved_usd": 0.5, "spent_usd": 0.2, "uncertain_usd": 0.0})
    budget.record_run(ledger, "run-1", allowance, "full", chunks=chunks)
    assert budget.ledger_spent(ledger) == pytest.approx(0.5)
    again = budget.open_allowance(5.0, ledger)
    assert again.available_usd == pytest.approx(5.0)
    import json

    (entry,) = json.loads(ledger.read_text(encoding="utf-8"))["runs"]
    assert entry["scope"] == "full"
    assert [chunk["cases"] for chunk in entry["chunks"]] == [["a"], ["b"]]


def test_a_provisional_charge_counts_as_spent_and_uncertain_until_it_is_replaced(
    tmp_path: Path,
) -> None:
    import json

    ledger = tmp_path / "ledger.json"
    allowance = budget.open_allowance(5.0, ledger)
    allowance.charge(0.3, "chunk 1")
    budget.record_run(ledger, "run-1", allowance, "running", provisional_usd=0.5)
    (entry,) = json.loads(ledger.read_text(encoding="utf-8"))["runs"]
    assert entry["provisional_usd"] == pytest.approx(0.5)
    assert entry["spent_usd"] == pytest.approx(0.8)
    assert entry["uncertain_usd"] == pytest.approx(0.5)
    assert budget.ledger_spent(ledger) == pytest.approx(0.8)
    allowance.charge(0.2, "chunk 2")
    budget.record_run(ledger, "run-1", allowance, "running")
    (entry,) = json.loads(ledger.read_text(encoding="utf-8"))["runs"]
    assert "provisional_usd" not in entry
    assert entry["spent_usd"] == pytest.approx(0.5)
    assert entry["uncertain_usd"] == 0
