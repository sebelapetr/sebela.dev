from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="TimeEntryUpdate")


@_attrs_define
class TimeEntryUpdate:
    """
    Attributes:
        resource (str | Unset): The slug of the resource that was studied; not sent with `event`.
        event (str | Unset): The slug of the event that was attended; not sent with `resource`. Every piece of the
            session must fall on a day of the event.
        started_at (datetime.datetime | Unset): An absolute instant with `Z` or a UTC offset, for example
            `2026-03-02T23:30:00+01:00`. A local time without an offset is refused.
        ended_at (datetime.datetime | Unset): An absolute instant with `Z` or a UTC offset, for example
            `2026-03-02T23:30:00+01:00`. A local time without an offset is refused.
    """

    resource: str | Unset = UNSET
    event: str | Unset = UNSET
    started_at: datetime.datetime | Unset = UNSET
    ended_at: datetime.datetime | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        resource = self.resource

        event = self.event

        started_at: str | Unset = UNSET
        if not isinstance(self.started_at, Unset):
            started_at = self.started_at.isoformat()

        ended_at: str | Unset = UNSET
        if not isinstance(self.ended_at, Unset):
            ended_at = self.ended_at.isoformat()

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if resource is not UNSET:
            field_dict["resource"] = resource
        if event is not UNSET:
            field_dict["event"] = event
        if started_at is not UNSET:
            field_dict["startedAt"] = started_at
        if ended_at is not UNSET:
            field_dict["endedAt"] = ended_at

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        resource = d.pop("resource", UNSET)

        event = d.pop("event", UNSET)

        _started_at = d.pop("startedAt", UNSET)
        started_at: datetime.datetime | Unset
        if isinstance(_started_at, Unset):
            started_at = UNSET
        else:
            started_at = datetime.datetime.fromisoformat(_started_at)

        _ended_at = d.pop("endedAt", UNSET)
        ended_at: datetime.datetime | Unset
        if isinstance(_ended_at, Unset):
            ended_at = UNSET
        else:
            ended_at = datetime.datetime.fromisoformat(_ended_at)

        time_entry_update = cls(
            resource=resource,
            event=event,
            started_at=started_at,
            ended_at=ended_at,
        )

        return time_entry_update
