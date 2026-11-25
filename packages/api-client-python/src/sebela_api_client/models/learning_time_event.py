from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

from ..models.learning_time_event_kind import LearningTimeEventKind

T = TypeVar("T", bound="LearningTimeEvent")


@_attrs_define
class LearningTimeEvent:
    """
    Attributes:
        slug (str): The stable, unique address of the record, for example `northwind-freight`.
        name (str):
        kind (LearningTimeEventKind):
        starts_on (datetime.date):
        ends_on (datetime.date):
        total_seconds (int): Attendance logged on the event.
    """

    slug: str
    name: str
    kind: LearningTimeEventKind
    starts_on: datetime.date
    ends_on: datetime.date
    total_seconds: int

    def to_dict(self) -> dict[str, Any]:
        slug = self.slug

        name = self.name

        kind = self.kind.value

        starts_on = self.starts_on.isoformat()

        ends_on = self.ends_on.isoformat()

        total_seconds = self.total_seconds

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "slug": slug,
                "name": name,
                "kind": kind,
                "startsOn": starts_on,
                "endsOn": ends_on,
                "totalSeconds": total_seconds,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        slug = d.pop("slug")

        name = d.pop("name")

        kind = LearningTimeEventKind(d.pop("kind"))

        starts_on = datetime.date.fromisoformat(d.pop("startsOn"))

        ends_on = datetime.date.fromisoformat(d.pop("endsOn"))

        total_seconds = d.pop("totalSeconds")

        learning_time_event = cls(
            slug=slug,
            name=name,
            kind=kind,
            starts_on=starts_on,
            ends_on=ends_on,
            total_seconds=total_seconds,
        )

        return learning_time_event
