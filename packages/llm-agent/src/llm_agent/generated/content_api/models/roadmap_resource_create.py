from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define

from ..models.roadmap_resource_create_status import RoadmapResourceCreateStatus
from ..models.roadmap_resource_create_type import RoadmapResourceCreateType
from ..types import UNSET, Unset

T = TypeVar("T", bound="RoadmapResourceCreate")


@_attrs_define
class RoadmapResourceCreate:
    """
    Attributes:
        slug (str): The stable, unique address of the record, for example `paldock`.
        module (str): The slug of an existing module.
        name (str):
        type_ (RoadmapResourceCreateType):
        position (int): Ascending order among its siblings; ties are ordered by slug.
        description (None | str | Unset): Markdown; `null` when there is none.
        status (RoadmapResourceCreateStatus | Unset):  Default: RoadmapResourceCreateStatus.PLANNED.
        estimated_minutes (int | None | Unset): Planned effort in minutes; `null` when unknown. It is not logged time.
        started_at (datetime.datetime | None | Unset): When studying started, if it did.
        finished_at (datetime.datetime | None | Unset): When studying finished, if it did; not before `startedAt`.
        link (None | str | Unset): An absolute `http` or `https` address; `null` when there is none.
        book (None | str | Unset): The slug of the existing book this resource reads; only a resource of type `book` can
            link one, and each book is linked by at most one resource. `null` when none.
        topics (list[str] | Unset): Slugs of existing topics, each once, in their intended order. On an update the list
            replaces every link; an omitted list leaves them unchanged.
    """

    slug: str
    module: str
    name: str
    type_: RoadmapResourceCreateType
    position: int
    description: None | str | Unset = UNSET
    status: RoadmapResourceCreateStatus | Unset = RoadmapResourceCreateStatus.PLANNED
    estimated_minutes: int | None | Unset = UNSET
    started_at: datetime.datetime | None | Unset = UNSET
    finished_at: datetime.datetime | None | Unset = UNSET
    link: None | str | Unset = UNSET
    book: None | str | Unset = UNSET
    topics: list[str] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        slug = self.slug

        module = self.module

        name = self.name

        type_ = self.type_.value

        position = self.position

        description: None | str | Unset
        if isinstance(self.description, Unset):
            description = UNSET
        else:
            description = self.description

        status: str | Unset = UNSET
        if not isinstance(self.status, Unset):
            status = self.status.value

        estimated_minutes: int | None | Unset
        if isinstance(self.estimated_minutes, Unset):
            estimated_minutes = UNSET
        else:
            estimated_minutes = self.estimated_minutes

        started_at: None | str | Unset
        if isinstance(self.started_at, Unset):
            started_at = UNSET
        elif isinstance(self.started_at, datetime.datetime):
            started_at = self.started_at.isoformat()
        else:
            started_at = self.started_at

        finished_at: None | str | Unset
        if isinstance(self.finished_at, Unset):
            finished_at = UNSET
        elif isinstance(self.finished_at, datetime.datetime):
            finished_at = self.finished_at.isoformat()
        else:
            finished_at = self.finished_at

        link: None | str | Unset
        if isinstance(self.link, Unset):
            link = UNSET
        else:
            link = self.link

        book: None | str | Unset
        if isinstance(self.book, Unset):
            book = UNSET
        else:
            book = self.book

        topics: list[str] | Unset = UNSET
        if not isinstance(self.topics, Unset):
            topics = self.topics

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "slug": slug,
                "module": module,
                "name": name,
                "type": type_,
                "position": position,
            }
        )
        if description is not UNSET:
            field_dict["description"] = description
        if status is not UNSET:
            field_dict["status"] = status
        if estimated_minutes is not UNSET:
            field_dict["estimatedMinutes"] = estimated_minutes
        if started_at is not UNSET:
            field_dict["startedAt"] = started_at
        if finished_at is not UNSET:
            field_dict["finishedAt"] = finished_at
        if link is not UNSET:
            field_dict["link"] = link
        if book is not UNSET:
            field_dict["book"] = book
        if topics is not UNSET:
            field_dict["topics"] = topics

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        slug = d.pop("slug")

        module = d.pop("module")

        name = d.pop("name")

        type_ = RoadmapResourceCreateType(d.pop("type"))

        position = d.pop("position")

        def _parse_description(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        description = _parse_description(d.pop("description", UNSET))

        _status = d.pop("status", UNSET)
        status: RoadmapResourceCreateStatus | Unset
        if isinstance(_status, Unset):
            status = UNSET
        else:
            status = RoadmapResourceCreateStatus(_status)

        def _parse_estimated_minutes(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        estimated_minutes = _parse_estimated_minutes(d.pop("estimatedMinutes", UNSET))

        def _parse_started_at(data: object) -> datetime.datetime | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                started_at_type_0 = datetime.datetime.fromisoformat(data)

                return started_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None | Unset, data)

        started_at = _parse_started_at(d.pop("startedAt", UNSET))

        def _parse_finished_at(data: object) -> datetime.datetime | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                finished_at_type_0 = datetime.datetime.fromisoformat(data)

                return finished_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None | Unset, data)

        finished_at = _parse_finished_at(d.pop("finishedAt", UNSET))

        def _parse_link(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        link = _parse_link(d.pop("link", UNSET))

        def _parse_book(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        book = _parse_book(d.pop("book", UNSET))

        topics = cast(list[str], d.pop("topics", UNSET))

        roadmap_resource_create = cls(
            slug=slug,
            module=module,
            name=name,
            type_=type_,
            position=position,
            description=description,
            status=status,
            estimated_minutes=estimated_minutes,
            started_at=started_at,
            finished_at=finished_at,
            link=link,
            book=book,
            topics=topics,
        )

        return roadmap_resource_create
