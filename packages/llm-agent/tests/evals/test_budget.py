"""The campaign allowance: a ceiling per phase campaign, the declared remainder, the ledger cap,
the stops of issue runs and reservations."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from evals import budget

P6 = budget.campaign("06-llm-agent")
P7 = budget.campaign("07-ai-service")


@pytest.mark.parametrize("value", ["0", "-1", "nan", "inf", "ten", "13.01"])
def test_an_invalid_or_over_ceiling_allowance_is_refused(value: str) -> None:
    with pytest.raises(budget.BudgetBlockedError):
        budget.parse_allowance(value, P6)


# --- A ceiling per phase campaign (decision 0026, point 7; issue #371) ------------------------


def test_every_phase_campaign_has_the_ceiling_and_stops_the_owner_approved() -> None:
    assert {name: entry.ceiling_usd for name, entry in budget.CAMPAIGNS.items()} == {
        "06-llm-agent": 13.0,
        "07-ai-service": 4.0,
        "07.1-jev-gateway": 2.0,
        "08-mcp-public": 2.3,
    }
    assert (P7.issue_stop_usd, P7.run_stop_usd) == (1.5, 1.0)
    assert budget.campaign("07.1-jev-gateway").run_stop_usd == 1.0
    assert budget.campaign("08-mcp-public").run_stop_usd == 1.0
    # The finished phase-6 campaign keeps the rules it ran under.
    assert (P6.issue_stop_usd, P6.run_stop_usd) == (None, None)


@pytest.mark.parametrize("name", [None, "", "07", "phase-7", "07-AI-SERVICE", "09-rag"])
def test_an_unknown_or_missing_campaign_is_a_block_never_a_default(name: str | None) -> None:
    with pytest.raises(budget.BudgetBlockedError, match="campaign"):
        budget.campaign(name)


def test_a_run_names_its_campaign_by_option_or_environment_and_they_may_not_differ() -> None:
    env = {budget.CAMPAIGN_ENVIRONMENT: "07-ai-service"}
    assert budget.named_campaign(None, env) == P7
    assert budget.named_campaign("07-ai-service", {}) == P7
    assert budget.named_campaign("07-ai-service", env) == P7
    with pytest.raises(budget.BudgetBlockedError, match="differs"):
        budget.named_campaign("06-llm-agent", env)
    with pytest.raises(budget.BudgetBlockedError, match="names no campaign"):
        budget.named_campaign(None, {})
    with pytest.raises(budget.BudgetBlockedError, match="names no campaign"):
        budget.named_campaign(None, {budget.CAMPAIGN_ENVIRONMENT: " "})


def test_an_allowance_above_the_campaign_s_own_ceiling_is_refused() -> None:
    assert budget.parse_allowance("4", P7) == 4.0
    with pytest.raises(budget.BudgetBlockedError, match=r"4\.00 USD ceiling of the 07-ai-service"):
        budget.parse_allowance("4.01", P7)
    # What phase 6 could declare is no longer grantable to a later phase.
    with pytest.raises(budget.BudgetBlockedError):
        budget.parse_allowance("10", P7)


def test_one_campaign_cannot_spend_another_s_ceiling(tmp_path: Path) -> None:
    ledger = tmp_path / "ledger.json"
    earlier = budget.open_allowance(13.0, ledger, P6, "phase-pr")
    earlier.charge(12.0, "the phase-6 campaign")
    budget.record_run(ledger, "p6", earlier, "full")
    fresh = budget.open_allowance(4.0, ledger, P7, "phase-pr")
    assert fresh.available_usd == pytest.approx(4.0)
    fresh.charge(3.9, "the phase-7 phase-PR run")
    budget.record_run(ledger, "p7", fresh, "full")
    assert budget.ledger_spent(ledger, "06-llm-agent") == pytest.approx(12.0)
    assert budget.ledger_spent(ledger, "07-ai-service") == pytest.approx(3.9)
    assert budget.open_allowance(13.0, ledger, P6, "phase-pr").available_usd == pytest.approx(1.0)
    assert budget.open_allowance(4.0, ledger, P7, "phase-pr").available_usd == pytest.approx(0.1)
    assert budget.open_allowance(
        2.0, ledger, budget.campaign("07.1-jev-gateway"), "phase-pr"
    ).available_usd == pytest.approx(2.0)


def test_ledger_entries_written_before_campaigns_belong_to_phase_6(tmp_path: Path) -> None:
    ledger = tmp_path / "ledger.json"
    ledger.write_text(
        json.dumps({"runs": [{"run": "old", "spent_usd": 9.75, "uncertain_usd": 0.5}]})
    )
    assert budget.ledger_spent(ledger, "06-llm-agent") == pytest.approx(9.75)
    assert budget.ledger_spent(ledger, "07-ai-service") == 0.0
    assert budget.open_allowance(13.0, ledger, P6, "issue").available_usd == pytest.approx(3.25)
    assert budget.open_allowance(4.0, ledger, P7, "phase-pr").available_usd == pytest.approx(4.0)


def test_an_issue_run_stops_at_the_per_run_stop(tmp_path: Path) -> None:
    ledger = tmp_path / "ledger.json"
    assert budget.open_allowance(4.0, ledger, P7, "issue").available_usd == pytest.approx(1.0)
    # The full phase-PR run is not bound by it.
    assert budget.open_allowance(4.0, ledger, P7, "phase-pr").available_usd == pytest.approx(4.0)
    # A smaller declared allowance still wins.
    assert budget.open_allowance(0.4, ledger, P7, "issue").available_usd == pytest.approx(0.4)


def test_issue_runs_stop_at_their_cumulative_stop_and_leave_the_phase_pr_reserve(
    tmp_path: Path,
) -> None:
    ledger = tmp_path / "ledger.json"
    for number, usd in enumerate((0.9, 0.4)):
        run = budget.open_allowance(4.0, ledger, P7, "issue")
        run.charge(usd, "issue work")
        budget.record_run(ledger, f"issue-{number}", run, "partial")
    third = budget.open_allowance(4.0, ledger, P7, "issue")
    assert third.available_usd == pytest.approx(0.2)
    third.charge(0.2, "the rest of the issue work")
    budget.record_run(ledger, "issue-2", third, "partial")
    with pytest.raises(budget.BudgetBlockedError, match=r"issue runs.*1\.50 USD"):
        budget.open_allowance(4.0, ledger, P7, "issue")
    # The phase-PR run still has the rest of the ceiling; its spend does not count as issue work.
    reserve = budget.open_allowance(4.0, ledger, P7, "phase-pr")
    assert reserve.available_usd == pytest.approx(2.5)
    reserve.charge(2.0, "the phase-PR run")
    budget.record_run(ledger, "phase-pr", reserve, "full")
    assert budget.ledger_spent(ledger, "07-ai-service", stage="issue") == pytest.approx(1.5)
    assert budget.open_allowance(4.0, ledger, P7, "phase-pr").available_usd == pytest.approx(0.5)


def test_an_exhausted_ceiling_blocks_and_names_the_campaign(tmp_path: Path) -> None:
    ledger = tmp_path / "ledger.json"
    spent = budget.open_allowance(4.0, ledger, P7, "phase-pr")
    spent.charge(4.0, "everything")
    budget.record_run(ledger, "run-1", spent, "full")
    for stage in budget.STAGES:
        with pytest.raises(budget.BudgetBlockedError, match=r"07-ai-service.*exhausted"):
            budget.open_allowance(1.0, ledger, P7, stage)


@pytest.mark.parametrize("stage", ["", "pr", "full", "Issue", None])
def test_an_unknown_stage_is_refused(tmp_path: Path, stage: str | None) -> None:
    with pytest.raises(budget.BudgetBlockedError, match="stage"):
        budget.open_allowance(1.0, tmp_path / "ledger.json", P7, stage)  # type: ignore[arg-type]


def test_a_ledger_entry_names_its_campaign_stage_and_expected_cost(tmp_path: Path) -> None:
    ledger = tmp_path / "ledger.json"
    allowance = budget.open_allowance(1.0, ledger, P7, "issue")
    allowance.charge(0.25, "work")
    budget.record_run(ledger, "run-1", allowance, "partial", expected_usd=0.2)
    (entry,) = json.loads(ledger.read_text(encoding="utf-8"))["runs"]
    assert (entry["campaign"], entry["stage"]) == ("07-ai-service", "issue")
    assert entry["expected_usd"] == pytest.approx(0.2)


def test_an_allowance_without_a_campaign_cannot_be_recorded(tmp_path: Path) -> None:
    loose = budget.Allowance(available_usd=1.0)
    with pytest.raises(budget.BudgetBlockedError, match="campaign"):
        budget.record_run(tmp_path / "ledger.json", "run-1", loose, "partial")


def test_the_remainder_of_the_campaign_ceiling_follows_the_run(tmp_path: Path) -> None:
    ledger = tmp_path / "ledger.json"
    first = budget.open_allowance(4.0, ledger, P7, "issue")
    first.charge(0.5, "work")
    budget.record_run(ledger, "run-1", first, "partial")
    second = budget.open_allowance(4.0, ledger, P7, "issue")
    assert second.campaign_remaining_usd == pytest.approx(3.5)
    second.charge(0.25, "more work")
    assert second.campaign_remaining_usd == pytest.approx(3.25)


def test_the_spend_line_states_expected_actual_and_the_remainder(tmp_path: Path) -> None:
    allowance = budget.open_allowance(4.0, tmp_path / "ledger.json", P7, "issue")
    assert budget.spend_line(allowance, expected_usd=0.3) == (
        "spend: expected 0.3000 USD before the run;"
        " 4.0000 USD of the 07-ai-service ceiling (4.00 USD) remain"
    )
    allowance.charge(0.2, "measured")
    allowance.charge(0.02, "crashed", uncertain=True)
    assert budget.spend_line(allowance, expected_usd=0.3, finished=True) == (
        "spend: expected 0.3000 USD, actual 0.2200 USD (uncertain 0.0200);"
        " 3.7800 USD of the 07-ai-service ceiling (4.00 USD) remain"
    )


def test_the_ledger_caps_what_a_declared_allowance_grants(tmp_path: Path) -> None:
    ledger = tmp_path / "ledger.json"
    first = budget.open_allowance(13.0, ledger, P6, "issue")
    first.charge(12.5, "earlier run")
    budget.record_run(ledger, "run-1", first, "partial")
    second = budget.open_allowance(13.0, ledger, P6, "issue")
    assert second.available_usd == pytest.approx(0.5)


def test_an_exhausted_campaign_blocks(tmp_path: Path) -> None:
    ledger = tmp_path / "ledger.json"
    spent = budget.open_allowance(13.0, ledger, P6, "issue")
    spent.charge(13.0, "everything")
    budget.record_run(ledger, "run-1", spent, "partial")
    with pytest.raises(budget.BudgetBlockedError):
        budget.open_allowance(5.0, ledger, P6, "issue")


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
    allowance = budget.open_allowance(5.0, ledger, P6, "issue")
    allowance.charge(0.3, "chunk 1")
    chunks = [{"cases": ["a"], "reserved_usd": 0.5, "spent_usd": 0.3, "uncertain_usd": 0.0}]
    budget.record_run(ledger, "run-1", allowance, "running", chunks=chunks)
    allowance.charge(0.2, "chunk 2")
    chunks.append({"cases": ["b"], "reserved_usd": 0.5, "spent_usd": 0.2, "uncertain_usd": 0.0})
    budget.record_run(ledger, "run-1", allowance, "full", chunks=chunks)
    assert budget.ledger_spent(ledger, "06-llm-agent") == pytest.approx(0.5)
    again = budget.open_allowance(5.0, ledger, P6, "issue")
    assert again.available_usd == pytest.approx(5.0)
    (entry,) = json.loads(ledger.read_text(encoding="utf-8"))["runs"]
    assert entry["scope"] == "full"
    assert [chunk["cases"] for chunk in entry["chunks"]] == [["a"], ["b"]]


def test_a_provisional_charge_counts_as_spent_and_uncertain_until_it_is_replaced(
    tmp_path: Path,
) -> None:
    ledger = tmp_path / "ledger.json"
    allowance = budget.open_allowance(5.0, ledger, P6, "issue")
    allowance.charge(0.3, "chunk 1")
    budget.record_run(ledger, "run-1", allowance, "running", provisional_usd=0.5)
    (entry,) = json.loads(ledger.read_text(encoding="utf-8"))["runs"]
    assert entry["provisional_usd"] == pytest.approx(0.5)
    assert entry["spent_usd"] == pytest.approx(0.8)
    assert entry["uncertain_usd"] == pytest.approx(0.5)
    assert budget.ledger_spent(ledger, "06-llm-agent") == pytest.approx(0.8)
    allowance.charge(0.2, "chunk 2")
    budget.record_run(ledger, "run-1", allowance, "running")
    (entry,) = json.loads(ledger.read_text(encoding="utf-8"))["runs"]
    assert "provisional_usd" not in entry
    assert entry["spent_usd"] == pytest.approx(0.5)
    assert entry["uncertain_usd"] == 0


# --- The loop's kept runs: issue spend across worktrees (issue #384, item 1) -------------------


def _kept(path: Path, *runs: tuple[str, str, str, float]) -> Path:
    """The phase loop's kept spend record, as `harness/steward.mjs` writes it."""
    path.write_text(
        json.dumps(
            {
                "runs": [
                    {
                        "key": f"{source}/{run}",
                        "source": source,
                        "run": run,
                        "campaign": "07-ai-service",
                        "stage": stage,
                        "spentUsd": spent,
                        "uncertainUsd": 0,
                    }
                    for source, run, stage, spent in runs
                ]
            }
        ),
        encoding="utf-8",
    )
    return path


def test_every_issue_worktree_does_not_start_with_a_fresh_issue_stop(tmp_path: Path) -> None:
    ledger = tmp_path / "ledger.json"
    kept = budget.KeptRuns(
        _kept(
            tmp_path / "eval-spend.json",
            ("feat-1-x", "r1", "issue", 0.5),
            ("feat-2-y", "r1", "issue", 0.5),
        ),
        source="feat-3-z",
    )
    # Without the loop's record this worktree would get a whole per-run stop of USD 1.00.
    assert budget.open_allowance(4.0, ledger, P7, "issue").available_usd == pytest.approx(1.0)
    third = budget.open_allowance(4.0, ledger, P7, "issue", kept=kept)
    assert third.available_usd == pytest.approx(0.5)
    assert third.campaign_remaining_usd == pytest.approx(3.0)
    third.charge(0.5, "the rest of the issue work")
    budget.record_run(ledger, "r1", third, "partial")
    with pytest.raises(budget.BudgetBlockedError, match=r"issue runs.*1\.50 USD"):
        budget.open_allowance(4.0, ledger, P7, "issue", kept=kept)


def test_three_issue_worktrees_of_one_dollar_each_are_past_the_issue_stop(tmp_path: Path) -> None:
    kept = budget.KeptRuns(
        _kept(
            tmp_path / "eval-spend.json",
            ("feat-1-x", "r1", "issue", 1.0),
            ("feat-2-y", "r1", "issue", 1.0),
        ),
        source="feat-3-z",
    )
    with pytest.raises(budget.BudgetBlockedError, match="issue runs"):
        budget.open_allowance(4.0, tmp_path / "ledger.json", P7, "issue", kept=kept)
    assert budget.ledger_spent(
        tmp_path / "ledger.json", "07-ai-service", stage="issue", kept=kept
    ) == pytest.approx(2.0)


def test_the_kept_runs_of_this_checkout_are_counted_once_from_its_own_ledger(
    tmp_path: Path,
) -> None:
    ledger = tmp_path / "ledger.json"
    own = budget.open_allowance(4.0, ledger, P7, "issue")
    own.charge(0.4, "this worktree's run")
    budget.record_run(ledger, "r1", own, "partial")
    kept = budget.KeptRuns(
        _kept(
            tmp_path / "eval-spend.json",
            ("feat-3-z", "r1", "issue", 0.3),  # an older reading of the same run
            ("feat-1-x", "r1", "issue", 0.25),
            ("feat-1-x", "r2", "phase-pr", 2.0),
        ),
        source="feat-3-z",
    )
    assert budget.ledger_spent(ledger, "07-ai-service", stage="issue", kept=kept) == pytest.approx(
        0.65
    )
    assert budget.ledger_spent(ledger, "07-ai-service", kept=kept) == pytest.approx(2.65)
    assert budget.ledger_spent(ledger, "06-llm-agent", kept=kept) == 0.0


def test_a_kept_record_that_is_not_there_yet_adds_nothing(tmp_path: Path) -> None:
    kept = budget.KeptRuns(tmp_path / "eval-spend.json", source="feat-3-z")
    assert budget.ledger_spent(tmp_path / "ledger.json", "07-ai-service", kept=kept) == 0.0


@pytest.mark.parametrize("text", ["{ broken", "[]", '{"runs": "none"}', '{"runs": [{"run": 1}]}'])
def test_a_kept_record_that_cannot_be_read_is_a_block_never_zero(tmp_path: Path, text: str) -> None:
    path = tmp_path / "eval-spend.json"
    path.write_text(text, encoding="utf-8")
    kept = budget.KeptRuns(path, source="feat-3-z")
    with pytest.raises(budget.BudgetBlockedError, match="kept"):
        budget.open_allowance(4.0, tmp_path / "ledger.json", P7, "issue", kept=kept)


def test_the_loop_names_its_kept_record_in_the_environment(tmp_path: Path) -> None:
    path = tmp_path / "eval-spend.json"
    main = tmp_path / "repo"
    worktree = main / ".worktrees" / "feat-3-z"
    env = {budget.KEPT_RUNS_ENVIRONMENT: str(path)}
    assert budget.kept_runs(env, worktree) == budget.KeptRuns(path, source="feat-3-z")
    assert budget.kept_runs(env, main) == budget.KeptRuns(path, source="the main checkout")
    assert budget.kept_runs({}, worktree) is None
    assert budget.kept_runs({budget.KEPT_RUNS_ENVIRONMENT: " "}, worktree) is None


# --- Concurrent runs in one checkout (issue #384, item 12) --------------------------------------


def test_runs_recording_at_the_same_time_do_not_lose_each_other_s_entries(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import threading
    import time

    ledger = tmp_path / "ledger.json"
    real_loads = json.loads

    def slow_loads(text: str) -> object:
        # Widens the window between reading the ledger and writing it back.
        data = real_loads(text)
        time.sleep(0.002)
        return data

    monkeypatch.setattr(budget.json, "loads", slow_loads)

    def record(worker: int) -> None:
        for number in range(15):
            allowance = budget.Allowance(available_usd=1.0, campaign=P7, stage="issue")
            allowance.charge(0.01, "work")
            budget.record_run(ledger, f"run-{worker}-{number}", allowance, "partial")

    workers = [threading.Thread(target=record, args=(worker,)) for worker in range(4)]
    for worker in workers:
        worker.start()
    for worker in workers:
        worker.join()
    monkeypatch.setattr(budget.json, "loads", real_loads)
    runs = json.loads(ledger.read_text(encoding="utf-8"))["runs"]
    assert len(runs) == 60
    assert budget.ledger_spent(ledger, "07-ai-service") == pytest.approx(0.6)
    assert not list(tmp_path.glob("*.tmp"))
