from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

from ..models.exploration_status import ExplorationStatus

if TYPE_CHECKING:
    from ..models.technology import Technology
    from ..models.topic import Topic


T = TypeVar("T", bound="Exploration")


@_attrs_define
class Exploration:
    """
    Attributes:
        id (UUID):
        slug (str): The stable, unique address of the record, for example `northwind-freight`.
        name (str):
        summary (str): Markdown.
        status (ExplorationStatus): How far the exploration got: `built` (it exists and runs), `tested` (it was tried
            out) or `designed` (it exists only as a design). Returned exactly as stored.
        concepts (list[str]): Plain-text concepts the exploration covers, in their intended order.
        started_on (datetime.date): The first day of the exploration, an ISO date.
        ended_on (datetime.date | None): The last day of the exploration, an ISO date; `null` marks an ongoing one.
        position (int): Ascending order in the list; ties are ordered by slug.
        technologies (list[Technology]): The linked technologies, in their intended order.
        topics (list[Topic]): The linked topics, in their intended order.
        created_at (datetime.datetime):
        updated_at (datetime.datetime):
    """

    id: UUID
    slug: str
    name: str
    summary: str
    status: ExplorationStatus
    concepts: list[str]
    started_on: datetime.date
    ended_on: datetime.date | None
    position: int
    technologies: list[Technology]
    topics: list[Topic]
    created_at: datetime.datetime
    updated_at: datetime.datetime

    def to_dict(self) -> dict[str, Any]:
        id = str(self.id)

        slug = self.slug

        name = self.name

        summary = self.summary

        status = self.status.value

        concepts = self.concepts

        started_on = self.started_on.isoformat()

        ended_on: None | str
        if isinstance(self.ended_on, datetime.date):
            ended_on = self.ended_on.isoformat()
        else:
            ended_on = self.ended_on

        position = self.position

        technologies = []
        for technologies_item_data in self.technologies:
            technologies_item = technologies_item_data.to_dict()
            technologies.append(technologies_item)

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
                "summary": summary,
                "status": status,
                "concepts": concepts,
                "startedOn": started_on,
                "endedOn": ended_on,
                "position": position,
                "technologies": technologies,
                "topics": topics,
                "createdAt": created_at,
                "updatedAt": updated_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.technology import Technology
        from ..models.topic import Topic

        d = dict(src_dict)
        id = UUID(d.pop("id"))

        slug = d.pop("slug")

        name = d.pop("name")

        summary = d.pop("summary")

        status = ExplorationStatus(d.pop("status"))

        concepts = cast(list[str], d.pop("concepts"))

        started_on = datetime.date.fromisoformat(d.pop("startedOn"))

        def _parse_ended_on(data: object) -> datetime.date | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                ended_on_type_0 = datetime.date.fromisoformat(data)

                return ended_on_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.date | None, data)

        ended_on = _parse_ended_on(d.pop("endedOn"))

        position = d.pop("position")

        technologies = []
        _technologies = d.pop("technologies")
        for technologies_item_data in _technologies:
            technologies_item = Technology.from_dict(technologies_item_data)

            technologies.append(technologies_item)

        topics = []
        _topics = d.pop("topics")
        for topics_item_data in _topics:
            topics_item = Topic.from_dict(topics_item_data)

            topics.append(topics_item)

        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))

        updated_at = datetime.datetime.fromisoformat(d.pop("updatedAt"))

        exploration = cls(
            id=id,
            slug=slug,
            name=name,
            summary=summary,
            status=status,
            concepts=concepts,
            started_on=started_on,
            ended_on=ended_on,
            position=position,
            technologies=technologies,
            topics=topics,
            created_at=created_at,
            updated_at=updated_at,
        )

        return exploration
