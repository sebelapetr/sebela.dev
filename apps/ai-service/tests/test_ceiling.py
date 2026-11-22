"""The paid mode's daily ceiling: in-flight allowances count, a new UTC day starts empty."""

from __future__ import annotations

import datetime

from ai_service.runtime.ceiling import DailyCeiling


class Today:
    def __init__(self) -> None:
        self.value = datetime.date(2026, 11, 22)

    def __call__(self) -> datetime.date:
        return self.value


def test_reservations_stop_at_the_ceiling() -> None:
    ceiling = DailyCeiling(0.05, today=Today())
    assert ceiling.reserve(0.02) is not None
    assert ceiling.reserve(0.02) is not None
    assert ceiling.reserve(0.02) is None


def test_settling_keeps_the_reported_cost_and_frees_the_rest() -> None:
    ceiling = DailyCeiling(0.05, today=Today())
    first = ceiling.reserve(0.02)
    assert first is not None
    assert ceiling.reserve(0.02) is not None
    ceiling.settle(first, 0.001)
    assert ceiling.reserve(0.02) is not None
    assert ceiling.reserve(0.02) is None


def test_an_uncertain_cost_keeps_the_whole_reservation() -> None:
    ceiling = DailyCeiling(0.04, today=Today())
    first = ceiling.reserve(0.02)
    assert first is not None
    ceiling.settle(first, None)
    assert ceiling.reserve(0.02) is not None
    assert ceiling.reserve(0.02) is None


def test_a_new_day_starts_empty_and_late_settling_touches_only_its_own_day() -> None:
    today = Today()
    ceiling = DailyCeiling(0.02, today=today)
    first = ceiling.reserve(0.02)
    assert first is not None
    assert ceiling.reserve(0.02) is None
    today.value = datetime.date(2026, 11, 23)
    second = ceiling.reserve(0.02)
    assert second is not None
    ceiling.settle(first, 0.0)
    assert ceiling.reserve(0.02) is None
