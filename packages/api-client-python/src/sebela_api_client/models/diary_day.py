from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.diary_event import DiaryEvent
    from ..models.time_entry import TimeEntry


T = TypeVar("T", bound="DiaryDay")


@_attrs_define
class DiaryDay:
    """
    Attributes:
        date (datetime.date): A calendar day in Europe/Prague, `YYYY-MM-DD`.
        notes (None | str): Markdown; `null` when there are none.
        entries (list[TimeEntry]):
        events (list[DiaryEvent]): The events whose inclusive date range covers the day, by start date, then slug; they
            add no time.
        total_seconds (int): The sum of the entries' elapsed seconds, derived on read and never rounded.
    """

    date: datetime.date
    notes: None | str
    entries: list[TimeEntry]
    events: list[DiaryEvent]
    total_seconds: int

    def to_dict(self) -> dict[str, Any]:
        date = self.date.isoformat()

        notes: None | str
        notes = self.notes

        entries = []
        for entries_item_data in self.entries:
            entries_item = entries_item_data.to_dict()
            entries.append(entries_item)

        events = []
        for events_item_data in self.events:
            events_item = events_item_data.to_dict()
            events.append(events_item)

        total_seconds = self.total_seconds

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "date": date,
                "notes": notes,
                "entries": entries,
                "events": events,
                "totalSeconds": total_seconds,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.diary_event import DiaryEvent
        from ..models.time_entry import TimeEntry

        d = dict(src_dict)
        date = datetime.date.fromisoformat(d.pop("date"))

        def _parse_notes(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        notes = _parse_notes(d.pop("notes"))

        entries = []
        _entries = d.pop("entries")
        for entries_item_data in _entries:
            entries_item = TimeEntry.from_dict(entries_item_data)

            entries.append(entries_item)

        events = []
        _events = d.pop("events")
        for events_item_data in _events:
            events_item = DiaryEvent.from_dict(events_item_data)

            events.append(events_item)

        total_seconds = d.pop("totalSeconds")

        diary_day = cls(
            date=date,
            notes=notes,
            entries=entries,
            events=events,
            total_seconds=total_seconds,
        )

        return diary_day
