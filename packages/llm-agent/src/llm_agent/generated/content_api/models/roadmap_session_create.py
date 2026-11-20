from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="RoadmapSessionCreate")


@_attrs_define
class RoadmapSessionCreate:
    """
    Attributes:
        started_at (datetime.datetime): An absolute instant with `Z` or a UTC offset, for example
            `2026-03-02T23:30:00+01:00`. A local time without an offset is refused.
        ended_at (datetime.datetime): An absolute instant with `Z` or a UTC offset, for example
            `2026-03-02T23:30:00+01:00`. A local time without an offset is refused.
        resource (str | Unset): The slug of the resource that was studied; not sent with `event`.
        event (str | Unset): The slug of the event that was attended; not sent with `resource`. Every piece of the
            session must fall on a day of the event.
        notes (str | Unset): Markdown appended to the notes of the session's first day; earlier notes are kept.
    """

    started_at: datetime.datetime
    ended_at: datetime.datetime
    resource: str | Unset = UNSET
    event: str | Unset = UNSET
    notes: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        started_at = self.started_at.isoformat()

        ended_at = self.ended_at.isoformat()

        resource = self.resource

        event = self.event

        notes = self.notes

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "startedAt": started_at,
                "endedAt": ended_at,
            }
        )
        if resource is not UNSET:
            field_dict["resource"] = resource
        if event is not UNSET:
            field_dict["event"] = event
        if notes is not UNSET:
            field_dict["notes"] = notes

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        started_at = datetime.datetime.fromisoformat(d.pop("startedAt"))

        ended_at = datetime.datetime.fromisoformat(d.pop("endedAt"))

        resource = d.pop("resource", UNSET)

        event = d.pop("event", UNSET)

        notes = d.pop("notes", UNSET)

        roadmap_session_create = cls(
            started_at=started_at,
            ended_at=ended_at,
            resource=resource,
            event=event,
            notes=notes,
        )

        return roadmap_session_create
