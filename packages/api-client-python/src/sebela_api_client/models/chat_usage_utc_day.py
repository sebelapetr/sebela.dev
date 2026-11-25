from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="ChatUsageUtcDay")


@_attrs_define
class ChatUsageUtcDay:
    """
    Attributes:
        used (int):
        limit (int):
        percent (float):
        resets_at (datetime.datetime): The next UTC midnight, when the day resets.
    """

    used: int
    limit: int
    percent: float
    resets_at: datetime.datetime

    def to_dict(self) -> dict[str, Any]:
        used = self.used

        limit = self.limit

        percent = self.percent

        resets_at = self.resets_at.isoformat()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "used": used,
                "limit": limit,
                "percent": percent,
                "resetsAt": resets_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        used = d.pop("used")

        limit = d.pop("limit")

        percent = d.pop("percent")

        resets_at = datetime.datetime.fromisoformat(d.pop("resetsAt"))

        chat_usage_utc_day = cls(
            used=used,
            limit=limit,
            percent=percent,
            resets_at=resets_at,
        )

        return chat_usage_utc_day
