from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define

from ..models.roadmap_event_update_kind import RoadmapEventUpdateKind
from ..types import UNSET, Unset

T = TypeVar("T", bound="RoadmapEventUpdate")


@_attrs_define
class RoadmapEventUpdate:
    """
    Attributes:
        name (str | Unset):
        kind (RoadmapEventUpdateKind | Unset):
        organizer (None | str | Unset): Who organised it; `null` when unknown.
        starts_on (datetime.date | Unset): The first day of the event, `YYYY-MM-DD` in Europe/Prague, inclusive.
        ends_on (datetime.date | Unset): The last day of the event, `YYYY-MM-DD` in Europe/Prague, inclusive and not
            before `startsOn`; equal to it for a single-day event.
        place (None | str | Unset): Where it took place; `null` for an online event or when unknown.
        online (bool | Unset): Whether it was attended online.
        link (None | str | Unset): An absolute `http` or `https` address; `null` when there is none.
        takeaways (None | str | Unset): What was taken away, in Markdown; `null` when there is nothing yet.
        topics (list[str] | Unset): Slugs of existing shared topics, each once, in their intended order. On an update
            the list replaces every link; an omitted list leaves them unchanged.
    """

    name: str | Unset = UNSET
    kind: RoadmapEventUpdateKind | Unset = UNSET
    organizer: None | str | Unset = UNSET
    starts_on: datetime.date | Unset = UNSET
    ends_on: datetime.date | Unset = UNSET
    place: None | str | Unset = UNSET
    online: bool | Unset = UNSET
    link: None | str | Unset = UNSET
    takeaways: None | str | Unset = UNSET
    topics: list[str] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        kind: str | Unset = UNSET
        if not isinstance(self.kind, Unset):
            kind = self.kind.value

        organizer: None | str | Unset
        if isinstance(self.organizer, Unset):
            organizer = UNSET
        else:
            organizer = self.organizer

        starts_on: str | Unset = UNSET
        if not isinstance(self.starts_on, Unset):
            starts_on = self.starts_on.isoformat()

        ends_on: str | Unset = UNSET
        if not isinstance(self.ends_on, Unset):
            ends_on = self.ends_on.isoformat()

        place: None | str | Unset
        if isinstance(self.place, Unset):
            place = UNSET
        else:
            place = self.place

        online = self.online

        link: None | str | Unset
        if isinstance(self.link, Unset):
            link = UNSET
        else:
            link = self.link

        takeaways: None | str | Unset
        if isinstance(self.takeaways, Unset):
            takeaways = UNSET
        else:
            takeaways = self.takeaways

        topics: list[str] | Unset = UNSET
        if not isinstance(self.topics, Unset):
            topics = self.topics

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if name is not UNSET:
            field_dict["name"] = name
        if kind is not UNSET:
            field_dict["kind"] = kind
        if organizer is not UNSET:
            field_dict["organizer"] = organizer
        if starts_on is not UNSET:
            field_dict["startsOn"] = starts_on
        if ends_on is not UNSET:
            field_dict["endsOn"] = ends_on
        if place is not UNSET:
            field_dict["place"] = place
        if online is not UNSET:
            field_dict["online"] = online
        if link is not UNSET:
            field_dict["link"] = link
        if takeaways is not UNSET:
            field_dict["takeaways"] = takeaways
        if topics is not UNSET:
            field_dict["topics"] = topics

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        name = d.pop("name", UNSET)

        _kind = d.pop("kind", UNSET)
        kind: RoadmapEventUpdateKind | Unset
        if isinstance(_kind, Unset):
            kind = UNSET
        else:
            kind = RoadmapEventUpdateKind(_kind)

        def _parse_organizer(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        organizer = _parse_organizer(d.pop("organizer", UNSET))

        _starts_on = d.pop("startsOn", UNSET)
        starts_on: datetime.date | Unset
        if isinstance(_starts_on, Unset):
            starts_on = UNSET
        else:
            starts_on = datetime.date.fromisoformat(_starts_on)

        _ends_on = d.pop("endsOn", UNSET)
        ends_on: datetime.date | Unset
        if isinstance(_ends_on, Unset):
            ends_on = UNSET
        else:
            ends_on = datetime.date.fromisoformat(_ends_on)

        def _parse_place(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        place = _parse_place(d.pop("place", UNSET))

        online = d.pop("online", UNSET)

        def _parse_link(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        link = _parse_link(d.pop("link", UNSET))

        def _parse_takeaways(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        takeaways = _parse_takeaways(d.pop("takeaways", UNSET))

        topics = cast(list[str], d.pop("topics", UNSET))

        roadmap_event_update = cls(
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
        )

        return roadmap_event_update
