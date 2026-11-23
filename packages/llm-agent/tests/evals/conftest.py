"""Shared set-up of the eval tests."""

from __future__ import annotations

import pytest

from evals import budget


@pytest.fixture(autouse=True)
def phase_6_campaign(monkeypatch: pytest.MonkeyPatch) -> None:
    """A paid command must name its campaign (`--campaign` or the environment). The runner tests
    run in the finished phase-6 campaign unless a test names another or removes the variable.

    The phase loop's record of kept runs is not read either: a test that needs one sets its own,
    so the spend of a real run in the loop never leaks into a test's ledger."""
    monkeypatch.setenv(budget.CAMPAIGN_ENVIRONMENT, "06-llm-agent")
    monkeypatch.delenv(budget.KEPT_RUNS_ENVIRONMENT, raising=False)
