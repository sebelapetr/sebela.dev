"""The daily ceiling (stub)."""

from __future__ import annotations

import datetime
from collections.abc import Callable


class DailyCeiling:
    def __init__(self, limit_usd: float, *, today: Callable[[], datetime.date]) -> None:
        raise NotImplementedError(limit_usd, today)

    def reserve(self, amount_usd: float) -> object | None:
        raise NotImplementedError(amount_usd)

    def settle(self, reservation: object, cost_usd: float | None) -> None:
        raise NotImplementedError(reservation, cost_usd)
