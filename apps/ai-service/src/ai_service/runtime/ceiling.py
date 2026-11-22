"""The paid mode's own daily spending ceiling, per UTC day and per process.

An operation reserves its whole allowance before its first model call; settling keeps the
reported cost (or the whole reservation when the cost is uncertain) and frees the rest. A
reservation is settled against the day it was made in, so a new day always starts empty.
"""

from __future__ import annotations

import datetime
from collections.abc import Callable
from dataclasses import dataclass


@dataclass(frozen=True)
class Reservation:
    day: datetime.date
    amount_usd: float


def utc_today() -> datetime.date:
    return datetime.datetime.now(datetime.UTC).date()


class DailyCeiling:
    def __init__(self, limit_usd: float, *, today: Callable[[], datetime.date] = utc_today) -> None:
        self._limit = limit_usd
        self._today = today
        self._spent: dict[datetime.date, float] = {}

    def reserve(self, amount_usd: float) -> Reservation | None:
        """A reservation of `amount_usd` today, or None when it would pass the ceiling."""
        day = self._today()
        self._spent = {key: value for key, value in self._spent.items() if key >= day}
        spent = self._spent.get(day, 0.0)
        if spent + amount_usd > self._limit + 1e-12:
            return None
        self._spent[day] = spent + amount_usd
        return Reservation(day, amount_usd)

    def settle(self, reservation: Reservation, cost_usd: float | None) -> None:
        """Keeps `cost_usd` (all of the reservation when None) and frees the rest."""
        if reservation.day not in self._spent:
            return
        kept = reservation.amount_usd if cost_usd is None else max(cost_usd, 0.0)
        spent = self._spent[reservation.day] - reservation.amount_usd + kept
        self._spent[reservation.day] = max(0.0, spent)
