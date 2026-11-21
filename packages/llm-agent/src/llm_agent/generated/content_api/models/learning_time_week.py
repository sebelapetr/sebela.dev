from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="LearningTimeWeek")


@_attrs_define
class LearningTimeWeek:
    """
    Attributes:
        starts_on (datetime.date): The Monday that starts the week, `YYYY-MM-DD` in Europe/Prague.
        total_seconds (int): All logged time: the sum of the three categories.
        resource_seconds (int): Time logged on resources whose type is not `book`.
        book_seconds (int): Time logged on resources of type `book`, counted once.
        event_seconds (int): Attendance logged on events.
    """

    starts_on: datetime.date
    total_seconds: int
    resource_seconds: int
    book_seconds: int
    event_seconds: int

    def to_dict(self) -> dict[str, Any]:
        starts_on = self.starts_on.isoformat()

        total_seconds = self.total_seconds

        resource_seconds = self.resource_seconds

        book_seconds = self.book_seconds

        event_seconds = self.event_seconds

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "startsOn": starts_on,
                "totalSeconds": total_seconds,
                "resourceSeconds": resource_seconds,
                "bookSeconds": book_seconds,
                "eventSeconds": event_seconds,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        starts_on = datetime.date.fromisoformat(d.pop("startsOn"))

        total_seconds = d.pop("totalSeconds")

        resource_seconds = d.pop("resourceSeconds")

        book_seconds = d.pop("bookSeconds")

        event_seconds = d.pop("eventSeconds")

        learning_time_week = cls(
            starts_on=starts_on,
            total_seconds=total_seconds,
            resource_seconds=resource_seconds,
            book_seconds=book_seconds,
            event_seconds=event_seconds,
        )

        return learning_time_week
