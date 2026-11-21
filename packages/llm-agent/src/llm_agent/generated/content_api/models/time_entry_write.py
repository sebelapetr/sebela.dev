from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.time_entry import TimeEntry


T = TypeVar("T", bound="TimeEntryWrite")


@_attrs_define
class TimeEntryWrite:
    """
    Attributes:
        entries (list[TimeEntry]):
        dates (list[datetime.date]): Every changed day, old and new, in ascending order.
    """

    entries: list[TimeEntry]
    dates: list[datetime.date]

    def to_dict(self) -> dict[str, Any]:
        entries = []
        for entries_item_data in self.entries:
            entries_item = entries_item_data.to_dict()
            entries.append(entries_item)

        dates = []
        for dates_item_data in self.dates:
            dates_item = dates_item_data.isoformat()
            dates.append(dates_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "entries": entries,
                "dates": dates,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.time_entry import TimeEntry

        d = dict(src_dict)
        entries = []
        _entries = d.pop("entries")
        for entries_item_data in _entries:
            entries_item = TimeEntry.from_dict(entries_item_data)

            entries.append(entries_item)

        dates = []
        _dates = d.pop("dates")
        for dates_item_data in _dates:
            dates_item = datetime.date.fromisoformat(dates_item_data)

            dates.append(dates_item)

        time_entry_write = cls(
            entries=entries,
            dates=dates,
        )

        return time_entry_write
