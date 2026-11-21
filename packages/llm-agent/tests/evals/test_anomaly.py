"""The early anomaly stop of a paid run: pure rules, no model, no API."""

from __future__ import annotations

from evals import anomaly


def test_the_early_part_is_the_first_six_case_runs() -> None:
    assert anomaly.EARLY_CASE_RUNS == 6


def test_a_healthy_early_part_does_not_stop() -> None:
    outcomes = ["answered", "insufficient_evidence", "refused", "answered", "limit_reached", "x"]
    assert anomaly.early_stop(outcomes, judge_failures=0, spent_usd=0.1, uncertain_usd=0.0) is None


def test_two_limit_reached_unavailable_or_failed_case_runs_stop_the_run() -> None:
    for bad in (["limit_reached", "limit_reached"], ["unavailable", None], [None, None]):
        outcomes = ["answered"] * 4 + bad
        reason = anomaly.early_stop(outcomes, judge_failures=0, spent_usd=0.1, uncertain_usd=0.0)
        assert reason is not None
        assert "2 of the first 6 case-runs" in reason


def test_only_the_first_six_case_runs_count() -> None:
    outcomes = ["answered"] * 6 + ["limit_reached", "limit_reached"]
    assert anomaly.early_stop(outcomes, judge_failures=0, spent_usd=0.1, uncertain_usd=0.0) is None


def test_any_failed_judge_request_stops_the_run() -> None:
    reason = anomaly.early_stop(["answered"], judge_failures=1, spent_usd=0.1, uncertain_usd=0.0)
    assert reason == "1 judge request(s) failed"


def test_uncertain_cost_above_ten_percent_of_the_measured_cost_stops_the_run() -> None:
    # spent includes the uncertain share; measured = spent - uncertain.
    assert anomaly.early_stop([], judge_failures=0, spent_usd=0.11, uncertain_usd=0.01) is None
    reason = anomaly.early_stop([], judge_failures=0, spent_usd=0.12, uncertain_usd=0.011)
    assert reason is not None
    assert "uncertain cost" in reason
    assert anomaly.early_stop([], judge_failures=0, spent_usd=0.02, uncertain_usd=0.02)


def test_nothing_spent_is_no_anomaly() -> None:
    assert anomaly.early_stop([], judge_failures=0, spent_usd=0.0, uncertain_usd=0.0) is None
