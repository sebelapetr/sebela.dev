from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="LearningTimeMonth")


@_attrs_define
class LearningTimeMonth:
    """
    Attributes:
        month (str): The calendar month, `YYYY-MM` in Europe/Prague.
        total_seconds (int): All logged time: the sum of the three categories.
        resource_seconds (int): Time logged on resources whose type is not `book`.
        book_seconds (int): Time logged on resources of type `book`, counted once.
        event_seconds (int): Attendance logged on events.
    """

    month: str
    total_seconds: int
    resource_seconds: int
    book_seconds: int
    event_seconds: int

    def to_dict(self) -> dict[str, Any]:
        month = self.month

        total_seconds = self.total_seconds

        resource_seconds = self.resource_seconds

        book_seconds = self.book_seconds

        event_seconds = self.event_seconds

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "month": month,
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
        month = d.pop("month")

        total_seconds = d.pop("totalSeconds")

        resource_seconds = d.pop("resourceSeconds")

        book_seconds = d.pop("bookSeconds")

        event_seconds = d.pop("eventSeconds")

        learning_time_month = cls(
            month=month,
            total_seconds=total_seconds,
            resource_seconds=resource_seconds,
            book_seconds=book_seconds,
            event_seconds=event_seconds,
        )

        return learning_time_month
