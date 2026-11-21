from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

from ..models.roadmap_tree_resource_status import RoadmapTreeResourceStatus
from ..models.roadmap_tree_resource_type import RoadmapTreeResourceType

if TYPE_CHECKING:
    from ..models.topic import Topic


T = TypeVar("T", bound="RoadmapTreeResource")


@_attrs_define
class RoadmapTreeResource:
    """
    Attributes:
        id (UUID):
        slug (str): The stable, unique address of the record, for example `northwind-freight`.
        name (str):
        description (None | str): Markdown; `null` when there is none.
        type_ (RoadmapTreeResourceType):
        status (RoadmapTreeResourceStatus):
        estimated_minutes (int | None): Planned effort in minutes; `null` when unknown. It is not logged time.
        started_at (datetime.datetime | None): When studying started, if it did.
        finished_at (datetime.datetime | None): When studying finished, if it did; not before `startedAt`.
        link (None | str): An absolute `http` or `https` address; `null` when there is none.
        position (int): Ascending order among its siblings; ties are ordered by slug.
        book (None | str): The slug of the existing book this resource reads; only a resource of type `book` can link
            one, and each book is linked by at most one resource. `null` when none.
        topics (list[Topic]): The linked topics, in their order.
        created_at (datetime.datetime):
        updated_at (datetime.datetime):
    """

    id: UUID
    slug: str
    name: str
    description: None | str
    type_: RoadmapTreeResourceType
    status: RoadmapTreeResourceStatus
    estimated_minutes: int | None
    started_at: datetime.datetime | None
    finished_at: datetime.datetime | None
    link: None | str
    position: int
    book: None | str
    topics: list[Topic]
    created_at: datetime.datetime
    updated_at: datetime.datetime

    def to_dict(self) -> dict[str, Any]:
        id = str(self.id)

        slug = self.slug

        name = self.name

        description: None | str
        description = self.description

        type_ = self.type_.value

        status = self.status.value

        estimated_minutes: int | None
        estimated_minutes = self.estimated_minutes

        started_at: None | str
        if isinstance(self.started_at, datetime.datetime):
            started_at = self.started_at.isoformat()
        else:
            started_at = self.started_at

        finished_at: None | str
        if isinstance(self.finished_at, datetime.datetime):
            finished_at = self.finished_at.isoformat()
        else:
            finished_at = self.finished_at

        link: None | str
        link = self.link

        position = self.position

        book: None | str
        book = self.book

        topics = []
        for topics_item_data in self.topics:
            topics_item = topics_item_data.to_dict()
            topics.append(topics_item)

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "slug": slug,
                "name": name,
                "description": description,
                "type": type_,
                "status": status,
                "estimatedMinutes": estimated_minutes,
                "startedAt": started_at,
                "finishedAt": finished_at,
                "link": link,
                "position": position,
                "book": book,
                "topics": topics,
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

        def _parse_description(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        description = _parse_description(d.pop("description"))

        type_ = RoadmapTreeResourceType(d.pop("type"))

        status = RoadmapTreeResourceStatus(d.pop("status"))

        def _parse_estimated_minutes(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        estimated_minutes = _parse_estimated_minutes(d.pop("estimatedMinutes"))

        def _parse_started_at(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                started_at_type_0 = datetime.datetime.fromisoformat(data)

                return started_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        started_at = _parse_started_at(d.pop("startedAt"))

        def _parse_finished_at(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                finished_at_type_0 = datetime.datetime.fromisoformat(data)

                return finished_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        finished_at = _parse_finished_at(d.pop("finishedAt"))

        def _parse_link(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        link = _parse_link(d.pop("link"))

        position = d.pop("position")

        def _parse_book(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        book = _parse_book(d.pop("book"))

        topics = []
        _topics = d.pop("topics")
        for topics_item_data in _topics:
            topics_item = Topic.from_dict(topics_item_data)

            topics.append(topics_item)

        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))

        updated_at = datetime.datetime.fromisoformat(d.pop("updatedAt"))

        roadmap_tree_resource = cls(
            id=id,
            slug=slug,
            name=name,
            description=description,
            type_=type_,
            status=status,
            estimated_minutes=estimated_minutes,
            started_at=started_at,
            finished_at=finished_at,
            link=link,
            position=position,
            book=book,
            topics=topics,
            created_at=created_at,
            updated_at=updated_at,
        )

        return roadmap_tree_resource
