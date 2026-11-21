from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.diary_day import DiaryDay


T = TypeVar("T", bound="Diary")


@_attrs_define
class Diary:
    """
    Attributes:
        days (list[DiaryDay]):
    """

    days: list[DiaryDay]

    def to_dict(self) -> dict[str, Any]:
        days = []
        for days_item_data in self.days:
            days_item = days_item_data.to_dict()
            days.append(days_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "days": days,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.diary_day import DiaryDay

        d = dict(src_dict)
        days = []
        _days = d.pop("days")
        for days_item_data in _days:
            days_item = DiaryDay.from_dict(days_item_data)

            days.append(days_item)

        diary = cls(
            days=days,
        )

        return diary
