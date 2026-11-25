from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.project_link import ProjectLink


T = TypeVar("T", bound="ProjectUpdate")


@_attrs_define
class ProjectUpdate:
    """
    Attributes:
        name (str | Unset):
        summary (str | Unset): Markdown.
        problem (str | Unset): The problem the project solved. Markdown.
        work_done (str | Unset): The work done on the project. Markdown.
        result (str | Unset): What the project achieved. Markdown.
        started_on (datetime.date | Unset): The first day of the project, an ISO date.
        ended_on (datetime.date | None | Unset): The last day of the project, an ISO date; `null` marks an ongoing
            project.
        links (list[ProjectLink] | Unset): Outside links, in their intended order.
        selected_for_homepage (bool | Unset): Whether the project is selected for the homepage.
        position (int | Unset): Ascending order within the owning experience; ties are ordered by slug.
        cover_id (None | Unset | UUID): The identifier of the project's cover, an uploaded image.
        experience (str | Unset): The slug of the existing experience the project belongs to. On an update it moves the
            project to that experience.
        technologies (list[str] | Unset): Slugs of existing technologies, each once, in their intended order. On an
            update the list replaces every link; an omitted list leaves the links unchanged.
    """

    name: str | Unset = UNSET
    summary: str | Unset = UNSET
    problem: str | Unset = UNSET
    work_done: str | Unset = UNSET
    result: str | Unset = UNSET
    started_on: datetime.date | Unset = UNSET
    ended_on: datetime.date | None | Unset = UNSET
    links: list[ProjectLink] | Unset = UNSET
    selected_for_homepage: bool | Unset = UNSET
    position: int | Unset = UNSET
    cover_id: None | Unset | UUID = UNSET
    experience: str | Unset = UNSET
    technologies: list[str] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        summary = self.summary

        problem = self.problem

        work_done = self.work_done

        result = self.result

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

        links: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.links, Unset):
            links = []
            for links_item_data in self.links:
                links_item = links_item_data.to_dict()
                links.append(links_item)

        selected_for_homepage = self.selected_for_homepage

        position = self.position

        cover_id: None | str | Unset
        if isinstance(self.cover_id, Unset):
            cover_id = UNSET
        elif isinstance(self.cover_id, UUID):
            cover_id = str(self.cover_id)
        else:
            cover_id = self.cover_id

        experience = self.experience

        technologies: list[str] | Unset = UNSET
        if not isinstance(self.technologies, Unset):
            technologies = self.technologies

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if name is not UNSET:
            field_dict["name"] = name
        if summary is not UNSET:
            field_dict["summary"] = summary
        if problem is not UNSET:
            field_dict["problem"] = problem
        if work_done is not UNSET:
            field_dict["workDone"] = work_done
        if result is not UNSET:
            field_dict["result"] = result
        if started_on is not UNSET:
            field_dict["startedOn"] = started_on
        if ended_on is not UNSET:
            field_dict["endedOn"] = ended_on
        if links is not UNSET:
            field_dict["links"] = links
        if selected_for_homepage is not UNSET:
            field_dict["selectedForHomepage"] = selected_for_homepage
        if position is not UNSET:
            field_dict["position"] = position
        if cover_id is not UNSET:
            field_dict["coverId"] = cover_id
        if experience is not UNSET:
            field_dict["experience"] = experience
        if technologies is not UNSET:
            field_dict["technologies"] = technologies

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.project_link import ProjectLink

        d = dict(src_dict)
        name = d.pop("name", UNSET)

        summary = d.pop("summary", UNSET)

        problem = d.pop("problem", UNSET)

        work_done = d.pop("workDone", UNSET)

        result = d.pop("result", UNSET)

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

        _links = d.pop("links", UNSET)
        links: list[ProjectLink] | Unset = UNSET
        if _links is not UNSET:
            links = []
            for links_item_data in _links:
                links_item = ProjectLink.from_dict(links_item_data)

                links.append(links_item)

        selected_for_homepage = d.pop("selectedForHomepage", UNSET)

        position = d.pop("position", UNSET)

        def _parse_cover_id(data: object) -> None | Unset | UUID:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                cover_id_type_0 = UUID(data)

                return cover_id_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | Unset | UUID, data)

        cover_id = _parse_cover_id(d.pop("coverId", UNSET))

        experience = d.pop("experience", UNSET)

        technologies = cast(list[str], d.pop("technologies", UNSET))

        project_update = cls(
            name=name,
            summary=summary,
            problem=problem,
            work_done=work_done,
            result=result,
            started_on=started_on,
            ended_on=ended_on,
            links=links,
            selected_for_homepage=selected_for_homepage,
            position=position,
            cover_id=cover_id,
            experience=experience,
            technologies=technologies,
        )

        return project_update
