from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

from ..models.cv_exploration_status import CvExplorationStatus

if TYPE_CHECKING:
    from ..models.technology import Technology


T = TypeVar("T", bound="CvExploration")


@_attrs_define
class CvExploration:
    """An exploration in the CV's own section: independent work outside the career timeline, never an experience or a
    delivered project. `designed` means it exists only as a design.

        Attributes:
            id (UUID):
            slug (str): The stable, unique address of the record, for example `paldock`.
            name (str):
            summary (str): Markdown.
            status (CvExplorationStatus): How far the exploration got: `built` (it exists and runs), `tested` (it was tried
                out) or `designed` (it exists only as a design). Returned exactly as stored.
            concepts (list[str]): Plain-text concepts the exploration covers, in their intended order.
            started_on (datetime.date): The first day of the exploration, an ISO date.
            ended_on (datetime.date | None): The last day of the exploration, an ISO date; `null` marks an ongoing one.
            technologies (list[Technology]): The linked technologies, in their intended order.
    """

    id: UUID
    slug: str
    name: str
    summary: str
    status: CvExplorationStatus
    concepts: list[str]
    started_on: datetime.date
    ended_on: datetime.date | None
    technologies: list[Technology]

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

        technologies = []
        for technologies_item_data in self.technologies:
            technologies_item = technologies_item_data.to_dict()
            technologies.append(technologies_item)

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
                "technologies": technologies,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.technology import Technology

        d = dict(src_dict)
        id = UUID(d.pop("id"))

        slug = d.pop("slug")

        name = d.pop("name")

        summary = d.pop("summary")

        status = CvExplorationStatus(d.pop("status"))

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

        technologies = []
        _technologies = d.pop("technologies")
        for technologies_item_data in _technologies:
            technologies_item = Technology.from_dict(technologies_item_data)

            technologies.append(technologies_item)

        cv_exploration = cls(
            id=id,
            slug=slug,
            name=name,
            summary=summary,
            status=status,
            concepts=concepts,
            started_on=started_on,
            ended_on=ended_on,
            technologies=technologies,
        )

        return cv_exploration
