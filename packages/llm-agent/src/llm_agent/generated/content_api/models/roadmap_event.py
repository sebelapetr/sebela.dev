from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

from ..models.roadmap_event_kind import RoadmapEventKind

if TYPE_CHECKING:
    from ..models.topic import Topic


T = TypeVar("T", bound="RoadmapEvent")


@_attrs_define
class RoadmapEvent:
    """
    Attributes:
        id (UUID):
        slug (str): The stable, unique address of the record, for example `northwind-freight`.
        name (str):
        kind (RoadmapEventKind):
        organizer (None | str): Who organised it; `null` when unknown.
        starts_on (datetime.date): The first day of the event, `YYYY-MM-DD` in Europe/Prague, inclusive.
        ends_on (datetime.date): The last day of the event, `YYYY-MM-DD` in Europe/Prague, inclusive and not before
            `startsOn`; equal to it for a single-day event.
        place (None | str): Where it took place; `null` for an online event or when unknown.
        online (bool): Whether it was attended online.
        link (None | str): An absolute `http` or `https` address; `null` when there is none.
        takeaways (None | str): What was taken away, in Markdown; `null` when there is nothing yet.
        topics (list[Topic]): The linked topics, in their order.
        attendance_seconds (int): The elapsed seconds of the time entries logged on the event, derived on read. The date
            range alone contributes nothing.
        created_at (datetime.datetime):
        updated_at (datetime.datetime):
    """

    id: UUID
    slug: str
    name: str
    kind: RoadmapEventKind
    organizer: None | str
    starts_on: datetime.date
    ends_on: datetime.date
    place: None | str
    online: bool
    link: None | str
    takeaways: None | str
    topics: list[Topic]
    attendance_seconds: int
    created_at: datetime.datetime
    updated_at: datetime.datetime

    def to_dict(self) -> dict[str, Any]:
        id = str(self.id)

        slug = self.slug

        name = self.name

        kind = self.kind.value

        organizer: None | str
        organizer = self.organizer

        starts_on = self.starts_on.isoformat()

        ends_on = self.ends_on.isoformat()

        place: None | str
        place = self.place

        online = self.online

        link: None | str
        link = self.link

        takeaways: None | str
        takeaways = self.takeaways

        topics = []
        for topics_item_data in self.topics:
            topics_item = topics_item_data.to_dict()
            topics.append(topics_item)

        attendance_seconds = self.attendance_seconds

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "slug": slug,
                "name": name,
                "kind": kind,
                "organizer": organizer,
                "startsOn": starts_on,
                "endsOn": ends_on,
                "place": place,
                "online": online,
                "link": link,
                "takeaways": takeaways,
                "topics": topics,
                "attendanceSeconds": attendance_seconds,
                "createdAt": created_at,
                "updatedAt": updated_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.topic import Topic

        d = dict(src_dict)
        id = UUID(d.pop("id"))

        slug = d.pop("slug")

        name = d.pop("name")

        kind = RoadmapEventKind(d.pop("kind"))

        def _parse_organizer(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        organizer = _parse_organizer(d.pop("organizer"))

        starts_on = datetime.date.fromisoformat(d.pop("startsOn"))

        ends_on = datetime.date.fromisoformat(d.pop("endsOn"))

        def _parse_place(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        place = _parse_place(d.pop("place"))

        online = d.pop("online")

        def _parse_link(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        link = _parse_link(d.pop("link"))

        def _parse_takeaways(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        takeaways = _parse_takeaways(d.pop("takeaways"))

        topics = []
        _topics = d.pop("topics")
        for topics_item_data in _topics:
            topics_item = Topic.from_dict(topics_item_data)

            topics.append(topics_item)

        attendance_seconds = d.pop("attendanceSeconds")

        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))

        updated_at = datetime.datetime.fromisoformat(d.pop("updatedAt"))

        roadmap_event = cls(
            id=id,
            slug=slug,
            name=name,
            kind=kind,
            organizer=organizer,
            starts_on=starts_on,
            ends_on=ends_on,
            place=place,
            online=online,
            link=link,
            takeaways=takeaways,
            topics=topics,
            attendance_seconds=attendance_seconds,
            created_at=created_at,
            updated_at=updated_at,
        )

        return roadmap_event
