from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.diary_event import DiaryEvent
    from ..models.diary_resource import DiaryResource


T = TypeVar("T", bound="TimeEntry")


@_attrs_define
class TimeEntry:
    """
    Attributes:
        id (UUID):
        date (datetime.date): A calendar day in Europe/Prague, `YYYY-MM-DD`.
        resource (DiaryResource | None): The resource studied; `null` for attendance at an event.
        event (DiaryEvent | None): The event attended; `null` for a study session on a resource.
        started_at (datetime.datetime):
        ended_at (datetime.datetime):
        duration_seconds (int): The actual elapsed seconds between the endpoints, derived on read.
    """

    id: UUID
    date: datetime.date
    resource: DiaryResource | None
    event: DiaryEvent | None
    started_at: datetime.datetime
    ended_at: datetime.datetime
    duration_seconds: int

    def to_dict(self) -> dict[str, Any]:
        from ..models.diary_event import DiaryEvent
        from ..models.diary_resource import DiaryResource

        id = str(self.id)

        date = self.date.isoformat()

        resource: dict[str, Any] | None
        if isinstance(self.resource, DiaryResource):
            resource = self.resource.to_dict()
        else:
            resource = self.resource

        event: dict[str, Any] | None
        if isinstance(self.event, DiaryEvent):
            event = self.event.to_dict()
        else:
            event = self.event

        started_at = self.started_at.isoformat()

        ended_at = self.ended_at.isoformat()

        duration_seconds = self.duration_seconds

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "date": date,
                "resource": resource,
                "event": event,
                "startedAt": started_at,
                "endedAt": ended_at,
                "durationSeconds": duration_seconds,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.diary_event import DiaryEvent
        from ..models.diary_resource import DiaryResource

        d = dict(src_dict)
        id = UUID(d.pop("id"))

        date = datetime.date.fromisoformat(d.pop("date"))

        def _parse_resource(data: object) -> DiaryResource | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                resource_type_0 = DiaryResource.from_dict(data)

                return resource_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(DiaryResource | None, data)

        resource = _parse_resource(d.pop("resource"))

        def _parse_event(data: object) -> DiaryEvent | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                event_type_0 = DiaryEvent.from_dict(data)

                return event_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(DiaryEvent | None, data)

        event = _parse_event(d.pop("event"))

        started_at = datetime.datetime.fromisoformat(d.pop("startedAt"))

        ended_at = datetime.datetime.fromisoformat(d.pop("endedAt"))

        duration_seconds = d.pop("durationSeconds")

        time_entry = cls(
            id=id,
            date=date,
            resource=resource,
            event=event,
            started_at=started_at,
            ended_at=ended_at,
            duration_seconds=duration_seconds,
        )

        return time_entry
