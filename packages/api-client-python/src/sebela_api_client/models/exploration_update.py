from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define

from ..models.exploration_update_status import ExplorationUpdateStatus
from ..types import UNSET, Unset

T = TypeVar("T", bound="ExplorationUpdate")


@_attrs_define
class ExplorationUpdate:
    """
    Attributes:
        name (str | Unset):
        summary (str | Unset): Markdown.
        status (ExplorationUpdateStatus | Unset): How far the exploration got: `built` (it exists and runs), `tested`
            (it was tried out) or `designed` (it exists only as a design). Returned exactly as stored.
        concepts (list[str] | Unset): Plain-text concepts the exploration covers, in their intended order.
        started_on (datetime.date | Unset): The first day of the exploration, an ISO date.
        ended_on (datetime.date | None | Unset): The last day of the exploration, an ISO date; `null` marks an ongoing
            one.
        position (int | Unset): Ascending order in the list; ties are ordered by slug.
        technologies (list[str] | Unset): Slugs of existing technologies, each once, in their intended order. On an
            update the list replaces every link; an omitted list leaves the links unchanged.
        topics (list[str] | Unset): Slugs of existing topics, each once, in their intended order. On an update the list
            replaces every link; an omitted list leaves the links unchanged.
    """

    name: str | Unset = UNSET
    summary: str | Unset = UNSET
    status: ExplorationUpdateStatus | Unset = UNSET
    concepts: list[str] | Unset = UNSET
    started_on: datetime.date | Unset = UNSET
    ended_on: datetime.date | None | Unset = UNSET
    position: int | Unset = UNSET
    technologies: list[str] | Unset = UNSET
    topics: list[str] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        summary = self.summary

        status: str | Unset = UNSET
        if not isinstance(self.status, Unset):
            status = self.status.value

        concepts: list[str] | Unset = UNSET
        if not isinstance(self.concepts, Unset):
            concepts = self.concepts

        started_on: str | Unset = UNSET
        if not isinstance(self.started_on, Unset):
            started_on = self.started_on.isoformat()

        ended_on: None | str | Unset
        if isinstance(self.ended_on, Unset):
            ended_on = UNSET
        elif isinstance(self.ended_on, datetime.date):
            ended_on = self.ended_on.isoformat()
        else:
            ended_on = self.ended_on

        position = self.position

        technologies: list[str] | Unset = UNSET
        if not isinstance(self.technologies, Unset):
            technologies = self.technologies

        topics: list[str] | Unset = UNSET
        if not isinstance(self.topics, Unset):
            topics = self.topics

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if name is not UNSET:
            field_dict["name"] = name
        if summary is not UNSET:
            field_dict["summary"] = summary
        if status is not UNSET:
            field_dict["status"] = status
        if concepts is not UNSET:
            field_dict["concepts"] = concepts
        if started_on is not UNSET:
            field_dict["startedOn"] = started_on
        if ended_on is not UNSET:
            field_dict["endedOn"] = ended_on
        if position is not UNSET:
            field_dict["position"] = position
        if technologies is not UNSET:
            field_dict["technologies"] = technologies
        if topics is not UNSET:
            field_dict["topics"] = topics

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        name = d.pop("name", UNSET)

        summary = d.pop("summary", UNSET)

        _status = d.pop("status", UNSET)
        status: ExplorationUpdateStatus | Unset
        if isinstance(_status, Unset):
            status = UNSET
        else:
            status = ExplorationUpdateStatus(_status)

        concepts = cast(list[str], d.pop("concepts", UNSET))

        _started_on = d.pop("startedOn", UNSET)
        started_on: datetime.date | Unset
        if isinstance(_started_on, Unset):
            started_on = UNSET
        else:
            started_on = datetime.date.fromisoformat(_started_on)

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

        position = d.pop("position", UNSET)

        technologies = cast(list[str], d.pop("technologies", UNSET))

        topics = cast(list[str], d.pop("topics", UNSET))

        exploration_update = cls(
            name=name,
            summary=summary,
            status=status,
            concepts=concepts,
            started_on=started_on,
            ended_on=ended_on,
            position=position,
            technologies=technologies,
            topics=topics,
        )

        return exploration_update
