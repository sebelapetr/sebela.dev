from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="ChatUsageRollingTwoHours")


@_attrs_define
class ChatUsageRollingTwoHours:
    """
    Attributes:
        used (int):
        limit (int):
        percent (float):
        next_release_at (datetime.datetime | None): When the oldest counted operation leaves the rolling window; `null`
            when none counts.
    """

    used: int
    limit: int
    percent: float
    next_release_at: datetime.datetime | None

    def to_dict(self) -> dict[str, Any]:
        used = self.used

        limit = self.limit

        percent = self.percent

        next_release_at: None | str
        if isinstance(self.next_release_at, datetime.datetime):
            next_release_at = self.next_release_at.isoformat()
        else:
            next_release_at = self.next_release_at

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "used": used,
                "limit": limit,
                "percent": percent,
                "nextReleaseAt": next_release_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        used = d.pop("used")

        limit = d.pop("limit")

        percent = d.pop("percent")

        def _parse_next_release_at(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                next_release_at_type_0 = datetime.datetime.fromisoformat(data)

                return next_release_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        next_release_at = _parse_next_release_at(d.pop("nextReleaseAt"))

        chat_usage_rolling_two_hours = cls(
            used=used,
            limit=limit,
            percent=percent,
            next_release_at=next_release_at,
        )

        return chat_usage_rolling_two_hours
