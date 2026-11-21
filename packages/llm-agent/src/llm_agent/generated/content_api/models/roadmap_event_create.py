from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define

from ..models.roadmap_event_create_kind import RoadmapEventCreateKind
from ..types import UNSET, Unset

T = TypeVar("T", bound="RoadmapEventCreate")


@_attrs_define
class RoadmapEventCreate:
    """
    Attributes:
        slug (str): The stable, unique address of the record, for example `paldock`.
        name (str):
        kind (RoadmapEventCreateKind):
        starts_on (datetime.date): The first day of the event, `YYYY-MM-DD` in Europe/Prague, inclusive.
        ends_on (datetime.date): The last day of the event, `YYYY-MM-DD` in Europe/Prague, inclusive and not before
            `startsOn`; equal to it for a single-day event.
        organizer (None | str | Unset): Who organised it; `null` when unknown.
        place (None | str | Unset): Where it took place; `null` for an online event or when unknown.
        online (bool | Unset): Whether it was attended online. Default: False.
        link (None | str | Unset): An absolute `http` or `https` address; `null` when there is none.
        takeaways (None | str | Unset): What was taken away, in Markdown; `null` when there is nothing yet.
        topics (list[str] | Unset): Slugs of existing shared topics, each once, in their intended order. On an update
            the list replaces every link; an omitted list leaves them unchanged.
    """

    slug: str
    name: str
    kind: RoadmapEventCreateKind
    starts_on: datetime.date
    ends_on: datetime.date
    organizer: None | str | Unset = UNSET
    place: None | str | Unset = UNSET
    online: bool | Unset = False
    link: None | str | Unset = UNSET
    takeaways: None | str | Unset = UNSET
    topics: list[str] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        slug = self.slug

        name = self.name

        kind = self.kind.value

        starts_on = self.starts_on.isoformat()

        ends_on = self.ends_on.isoformat()

        organizer: None | str | Unset
        if isinstance(self.organizer, Unset):
            organizer = UNSET
        else:
            organizer = self.organizer

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

        field_dict.update(
            {
                "slug": slug,
                "name": name,
                "kind": kind,
                "startsOn": starts_on,
                "endsOn": ends_on,
            }
        )
        if organizer is not UNSET:
            field_dict["organizer"] = organizer
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
        slug = d.pop("slug")

        name = d.pop("name")

        kind = RoadmapEventCreateKind(d.pop("kind"))

        starts_on = datetime.date.fromisoformat(d.pop("startsOn"))

        ends_on = datetime.date.fromisoformat(d.pop("endsOn"))

        def _parse_organizer(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        organizer = _parse_organizer(d.pop("organizer", UNSET))

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

        roadmap_event_create = cls(
            slug=slug,
            name=name,
            kind=kind,
            starts_on=starts_on,
            ends_on=ends_on,
            organizer=organizer,
            place=place,
            online=online,
            link=link,
            takeaways=takeaways,
            topics=topics,
        )

        return roadmap_event_create
