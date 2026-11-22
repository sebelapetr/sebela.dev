from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="LearningTimeTotals")


@_attrs_define
class LearningTimeTotals:
    """
    Attributes:
        total_seconds (int): All logged time: the sum of the three categories.
        resource_seconds (int): Time logged on resources whose type is not `book`.
        book_seconds (int): Time logged on resources of type `book`, counted once.
        event_seconds (int): Attendance logged on events.
        active_days (int): The number of diary days with logged time.
    """

    total_seconds: int
    resource_seconds: int
    book_seconds: int
    event_seconds: int
    active_days: int

    def to_dict(self) -> dict[str, Any]:
        total_seconds = self.total_seconds

        resource_seconds = self.resource_seconds

        book_seconds = self.book_seconds

        event_seconds = self.event_seconds

        active_days = self.active_days

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "totalSeconds": total_seconds,
                "resourceSeconds": resource_seconds,
                "bookSeconds": book_seconds,
                "eventSeconds": event_seconds,
                "activeDays": active_days,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        total_seconds = d.pop("totalSeconds")

        resource_seconds = d.pop("resourceSeconds")

        book_seconds = d.pop("bookSeconds")

        event_seconds = d.pop("eventSeconds")

        active_days = d.pop("activeDays")

        learning_time_totals = cls(
            total_seconds=total_seconds,
            resource_seconds=resource_seconds,
            book_seconds=book_seconds,
            event_seconds=event_seconds,
            active_days=active_days,
        )

        return learning_time_totals
