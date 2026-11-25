from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define

from ..models.exploration_create_status import ExplorationCreateStatus
from ..types import UNSET, Unset

T = TypeVar("T", bound="ExplorationCreate")


@_attrs_define
class ExplorationCreate:
    """
    Attributes:
        slug (str): The stable, unique address of the record, for example `northwind-freight`.
        name (str):
        summary (str): Markdown.
        status (ExplorationCreateStatus): How far the exploration got: `built` (it exists and runs), `tested` (it was
            tried out) or `designed` (it exists only as a design). Returned exactly as stored.
        started_on (datetime.date): The first day of the exploration, an ISO date.
        position (int): Ascending order in the list; ties are ordered by slug.
        concepts (list[str] | Unset): Plain-text concepts the exploration covers, in their intended order.
        ended_on (datetime.date | None | Unset): The last day of the exploration, an ISO date; `null` marks an ongoing
            one.
        technologies (list[str] | Unset): Slugs of existing technologies, each once, in their intended order. On an
            update the list replaces every link; an omitted list leaves the links unchanged.
        topics (list[str] | Unset): Slugs of existing topics, each once, in their intended order. On an update the list
            replaces every link; an omitted list leaves the links unchanged.
    """

    slug: str
    name: str
    summary: str
    status: ExplorationCreateStatus
    started_on: datetime.date
    position: int
    concepts: list[str] | Unset = UNSET
    ended_on: datetime.date | None | Unset = UNSET
    technologies: list[str] | Unset = UNSET
    topics: list[str] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        slug = self.slug

        name = self.name

        summary = self.summary

        status = self.status.value

        started_on = self.started_on.isoformat()

        position = self.position

        concepts: list[str] | Unset = UNSET
        if not isinstance(self.concepts, Unset):
            concepts = self.concepts

        ended_on: None | str | Unset
        if isinstance(self.ended_on, Unset):
            ended_on = UNSET
        elif isinstance(self.ended_on, datetime.date):
            ended_on = self.ended_on.isoformat()
        else:
            ended_on = self.ended_on

        technologies: list[str] | Unset = UNSET
        if not isinstance(self.technologies, Unset):
            technologies = self.technologies

        topics: list[str] | Unset = UNSET
        if not isinstance(self.topics, Unset):
            topics = self.topics

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "slug": slug,
                "name": name,
                "summary": summary,
                "status": status,
                "startedOn": started_on,
                "position": position,
            }
        )
        if concepts is not UNSET:
            field_dict["concepts"] = concepts
        if ended_on is not UNSET:
            field_dict["endedOn"] = ended_on
        if technologies is not UNSET:
            field_dict["technologies"] = technologies
        if topics is not UNSET:
            field_dict["topics"] = topics

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        slug = d.pop("slug")

        name = d.pop("name")

        summary = d.pop("summary")

        status = ExplorationCreateStatus(d.pop("status"))

        started_on = datetime.date.fromisoformat(d.pop("startedOn"))

        position = d.pop("position")

        concepts = cast(list[str], d.pop("concepts", UNSET))

        def _parse_ended_on(data: object) -> datetime.date | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                ended_on_type_0 = datetime.date.fromisoformat(data)

                return ended_on_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.date | None | Unset, data)

        ended_on = _parse_ended_on(d.pop("endedOn", UNSET))

        technologies = cast(list[str], d.pop("technologies", UNSET))

        topics = cast(list[str], d.pop("topics", UNSET))

        exploration_create = cls(
            slug=slug,
            name=name,
            summary=summary,
            status=status,
            started_on=started_on,
            position=position,
            concepts=concepts,
            ended_on=ended_on,
            technologies=technologies,
            topics=topics,
        )

        return exploration_create
