"""The early anomaly stop of a paid run: after the early chunk, should the rest still be paid for?

A paid run (also a comparison or a paid regrade) first runs an early chunk of about
`EARLY_CASE_RUNS` case-runs. It stops before the rest when any of these holds:

- 2 or more of the first 6 case-runs ended `limit_reached`, `unavailable` or with a provider error
  (no outcome at all);
- any judge request failed;
- the uncertain cost exceeds 10 % of the measured cost (measured = spent - uncertain).

The stopped run's remaining cases are reported pending, never passed. Pure rules: no model, no API.
"""

from __future__ import annotations

from collections.abc import Sequence

#: The case-runs the early part of a paid run covers.
EARLY_CASE_RUNS = 6
#: Early case-runs that ended without an answer and stop the run.
STOPPED_OUTCOMES = frozenset({"limit_reached", "unavailable"})
STOPPED_RUNS_LIMIT = 2
#: The largest share of the measured cost that may be uncertain.
UNCERTAIN_SHARE = 0.1


def early_stop(
    outcomes: Sequence[str | None],
    *,
    judge_failures: int,
    spent_usd: float,
    uncertain_usd: float,
) -> str | None:
    """Why the run stops after its early chunk, or None when the rest may run.

    `outcomes` are the early case-runs' outcomes in order; None is a provider error or a missing
    case-run. `spent_usd` includes the uncertain share.
    """
    early = outcomes[:EARLY_CASE_RUNS]
    stopped = sum(1 for outcome in early if outcome is None or outcome in STOPPED_OUTCOMES)
    if stopped >= STOPPED_RUNS_LIMIT:
        return (
            f"at least {STOPPED_RUNS_LIMIT} of the first {EARLY_CASE_RUNS} case-runs ended"
            f" limit_reached, unavailable or with a provider error ({stopped} did)"
        )
    if judge_failures:
        return f"{judge_failures} judge request(s) failed"
    measured = spent_usd - uncertain_usd
    if uncertain_usd > UNCERTAIN_SHARE * measured + 1e-12:
        return (
            f"uncertain cost {uncertain_usd:.4f} USD exceeds 10% of the measured cost"
            f" {measured:.4f} USD"
        )
    return None
