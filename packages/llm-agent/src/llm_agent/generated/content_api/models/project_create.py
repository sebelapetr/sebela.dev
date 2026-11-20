from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.project_link import ProjectLink


T = TypeVar("T", bound="ProjectCreate")


@_attrs_define
class ProjectCreate:
    """
    Attributes:
        slug (str): The stable, unique address of the record, for example `paldock`.
        name (str):
        summary (str): Markdown.
        problem (str): The problem the project solved. Markdown.
        work_done (str): The work done on the project. Markdown.
        result (str): What the project achieved. Markdown.
        started_on (datetime.date): The first day of the project, an ISO date.
        position (int): Ascending order within the owning experience; ties are ordered by slug.
        experience (str): The slug of the existing experience the project belongs to. On an update it moves the project
            to that experience.
        ended_on (datetime.date | None | Unset): The last day of the project, an ISO date; `null` marks an ongoing
            project.
        links (list[ProjectLink] | Unset): Outside links, in their intended order.
        selected_for_homepage (bool | Unset): Whether the project is selected for the homepage. Default: False.
        cover_id (None | Unset | UUID): The identifier of the project's cover, an uploaded image.
        technologies (list[str] | Unset): Slugs of existing technologies, each once, in their intended order. On an
            update the list replaces every link; an omitted list leaves the links unchanged.
    """

    slug: str
    name: str
    summary: str
    problem: str
    work_done: str
    result: str
    started_on: datetime.date
    position: int
    experience: str
    ended_on: datetime.date | None | Unset = UNSET
    links: list[ProjectLink] | Unset = UNSET
    selected_for_homepage: bool | Unset = False
    cover_id: None | Unset | UUID = UNSET
    technologies: list[str] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        slug = self.slug

        name = self.name

        summary = self.summary

        problem = self.problem

        work_done = self.work_done

        result = self.result

        started_on = self.started_on.isoformat()

        position = self.position

        experience = self.experience

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

        cover_id: None | str | Unset
        if isinstance(self.cover_id, Unset):
            cover_id = UNSET
        elif isinstance(self.cover_id, UUID):
            cover_id = str(self.cover_id)
        else:
            cover_id = self.cover_id

        technologies: list[str] | Unset = UNSET
        if not isinstance(self.technologies, Unset):
            technologies = self.technologies

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "slug": slug,
                "name": name,
                "summary": summary,
                "problem": problem,
                "workDone": work_done,
                "result": result,
                "startedOn": started_on,
                "position": position,
                "experience": experience,
            }
        )
        if ended_on is not UNSET:
            field_dict["endedOn"] = ended_on
        if links is not UNSET:
            field_dict["links"] = links
        if selected_for_homepage is not UNSET:
            field_dict["selectedForHomepage"] = selected_for_homepage
        if cover_id is not UNSET:
            field_dict["coverId"] = cover_id
        if technologies is not UNSET:
            field_dict["technologies"] = technologies

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.project_link import ProjectLink

        d = dict(src_dict)
        slug = d.pop("slug")

        name = d.pop("name")

        summary = d.pop("summary")

        problem = d.pop("problem")

        work_done = d.pop("workDone")

        result = d.pop("result")

        started_on = datetime.date.fromisoformat(d.pop("startedOn"))

        position = d.pop("position")

        experience = d.pop("experience")

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

        technologies = cast(list[str], d.pop("technologies", UNSET))

        project_create = cls(
            slug=slug,
            name=name,
            summary=summary,
            problem=problem,
            work_done=work_done,
            result=result,
            started_on=started_on,
            position=position,
            experience=experience,
            ended_on=ended_on,
            links=links,
            selected_for_homepage=selected_for_homepage,
            cover_id=cover_id,
            technologies=technologies,
        )

        return project_create
