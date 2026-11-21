from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.case_study import CaseStudy
    from ..models.project_link import ProjectLink
    from ..models.technology import Technology


T = TypeVar("T", bound="Project")


@_attrs_define
class Project:
    """
    Attributes:
        id (UUID):
        slug (str): The stable, unique address of the record, for example `paldock`.
        experience (str): The slug of the experience the project belongs to; every project has exactly one.
        name (str):
        summary (str): Markdown.
        problem (str): The problem the project solved. Markdown.
        work_done (str): The work done on the project. Markdown.
        result (str): What the project achieved. Markdown.
        started_on (datetime.date): The first day of the project, an ISO date.
        ended_on (datetime.date | None): The last day of the project, an ISO date; `null` marks an ongoing project.
        links (list[ProjectLink]): Outside links, in their intended order.
        selected_for_homepage (bool): Whether the project is selected for the homepage.
        position (int): Ascending order within the owning experience; ties are ordered by slug.
        cover_id (None | UUID): The identifier of the project's cover, an uploaded image.
        technologies (list[Technology]): The linked technologies, in their intended order.
        case_study (CaseStudy | None): The long-form case study of the project, or `null` while it has none. It is
            written at `/v1/projects/{slug}/case-study`, never in a project body.
        created_at (datetime.datetime):
        updated_at (datetime.datetime):
    """

    id: UUID
    slug: str
    experience: str
    name: str
    summary: str
    problem: str
    work_done: str
    result: str
    started_on: datetime.date
    ended_on: datetime.date | None
    links: list[ProjectLink]
    selected_for_homepage: bool
    position: int
    cover_id: None | UUID
    technologies: list[Technology]
    case_study: CaseStudy | None
    created_at: datetime.datetime
    updated_at: datetime.datetime

    def to_dict(self) -> dict[str, Any]:
        from ..models.case_study import CaseStudy

        id = str(self.id)

        slug = self.slug

        experience = self.experience

        name = self.name

        summary = self.summary

        problem = self.problem

        work_done = self.work_done

        result = self.result

        started_on = self.started_on.isoformat()

        ended_on: None | str
        if isinstance(self.ended_on, datetime.date):
            ended_on = self.ended_on.isoformat()
        else:
            ended_on = self.ended_on

        links = []
        for links_item_data in self.links:
            links_item = links_item_data.to_dict()
            links.append(links_item)

        selected_for_homepage = self.selected_for_homepage

        position = self.position

        cover_id: None | str
        if isinstance(self.cover_id, UUID):
            cover_id = str(self.cover_id)
        else:
            cover_id = self.cover_id

        technologies = []
        for technologies_item_data in self.technologies:
            technologies_item = technologies_item_data.to_dict()
            technologies.append(technologies_item)

        case_study: dict[str, Any] | None
        if isinstance(self.case_study, CaseStudy):
            case_study = self.case_study.to_dict()
        else:
            case_study = self.case_study

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "slug": slug,
                "experience": experience,
                "name": name,
                "summary": summary,
                "problem": problem,
                "workDone": work_done,
                "result": result,
                "startedOn": started_on,
                "endedOn": ended_on,
                "links": links,
                "selectedForHomepage": selected_for_homepage,
                "position": position,
                "coverId": cover_id,
                "technologies": technologies,
                "caseStudy": case_study,
                "createdAt": created_at,
                "updatedAt": updated_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.case_study import CaseStudy
        from ..models.project_link import ProjectLink
        from ..models.technology import Technology

        d = dict(src_dict)
        id = UUID(d.pop("id"))

        slug = d.pop("slug")

        experience = d.pop("experience")

        name = d.pop("name")

        summary = d.pop("summary")

        problem = d.pop("problem")

        work_done = d.pop("workDone")

        result = d.pop("result")

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

        links = []
        _links = d.pop("links")
        for links_item_data in _links:
            links_item = ProjectLink.from_dict(links_item_data)

            links.append(links_item)

        selected_for_homepage = d.pop("selectedForHomepage")

        position = d.pop("position")

        def _parse_cover_id(data: object) -> None | UUID:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                cover_id_type_0 = UUID(data)

                return cover_id_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | UUID, data)

        cover_id = _parse_cover_id(d.pop("coverId"))

        technologies = []
        _technologies = d.pop("technologies")
        for technologies_item_data in _technologies:
            technologies_item = Technology.from_dict(technologies_item_data)

            technologies.append(technologies_item)

        def _parse_case_study(data: object) -> CaseStudy | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                case_study_type_0 = CaseStudy.from_dict(data)

                return case_study_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(CaseStudy | None, data)

        case_study = _parse_case_study(d.pop("caseStudy"))

        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))

        updated_at = datetime.datetime.fromisoformat(d.pop("updatedAt"))

        project = cls(
            id=id,
            slug=slug,
            experience=experience,
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
            technologies=technologies,
            case_study=case_study,
            created_at=created_at,
            updated_at=updated_at,
        )

        return project
