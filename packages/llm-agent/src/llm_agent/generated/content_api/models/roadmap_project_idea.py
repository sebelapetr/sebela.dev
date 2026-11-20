from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.topic import Topic


T = TypeVar("T", bound="RoadmapProjectIdea")


@_attrs_define
class RoadmapProjectIdea:
    """
    Attributes:
        id (UUID):
        slug (str): The stable identity of the record and its anchor on the website.
        title (str):
        why_it_matters (str): Why the project is worth doing, Markdown.
        how_to_start (None | str): How to begin, Markdown; `null` when there is no advice yet.
        position (int): Ascending order in its list; ties are ordered by slug.
        topics (list[Topic]): The linked topics, in their order.
        created_at (datetime.datetime):
        updated_at (datetime.datetime):
    """

    id: UUID
    slug: str
    title: str
    why_it_matters: str
    how_to_start: None | str
    position: int
    topics: list[Topic]
    created_at: datetime.datetime
    updated_at: datetime.datetime

    def to_dict(self) -> dict[str, Any]:
        id = str(self.id)

        slug = self.slug

        title = self.title

        why_it_matters = self.why_it_matters

        how_to_start: None | str
        how_to_start = self.how_to_start

        position = self.position

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
                "title": title,
                "whyItMatters": why_it_matters,
                "howToStart": how_to_start,
                "position": position,
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

        title = d.pop("title")

        why_it_matters = d.pop("whyItMatters")

        def _parse_how_to_start(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        how_to_start = _parse_how_to_start(d.pop("howToStart"))

        position = d.pop("position")

        topics = []
        _topics = d.pop("topics")
        for topics_item_data in _topics:
            topics_item = Topic.from_dict(topics_item_data)

            topics.append(topics_item)

        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))

        updated_at = datetime.datetime.fromisoformat(d.pop("updatedAt"))

        roadmap_project_idea = cls(
            id=id,
            slug=slug,
            title=title,
            why_it_matters=why_it_matters,
            how_to_start=how_to_start,
            position=position,
            topics=topics,
            created_at=created_at,
            updated_at=updated_at,
        )

        return roadmap_project_idea
