from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

from ..models.experience_kind import ExperienceKind

if TYPE_CHECKING:
    from ..models.organization import Organization
    from ..models.project import Project
    from ..models.technology import Technology
    from ..models.testimonial import Testimonial


T = TypeVar("T", bound="Experience")


@_attrs_define
class Experience:
    """
    Attributes:
        id (UUID):
        slug (str): The stable, unique address of the record, for example `northwind-freight`.
        title (str):
        kind (ExperienceKind): A `main_job`, a `side_project` or an `own_business`.
        started_on (datetime.date): The first day of the role, an ISO date.
        ended_on (datetime.date | None): The last day of the role, an ISO date; `null` marks a current role.
        summary (str): Markdown.
        responsibilities (list[str]): Plain-text responsibilities, in their intended order.
        in_cv (bool): Whether the experience appears in the CV.
        organization (Organization):
        technologies (list[Technology]): The linked technologies, in their intended order.
        projects (list[Project]): The projects delivered within the experience, by position, then slug; each says
            whether it is selected for the homepage.
        testimonials (list[Testimonial]): The quotes of clients and colleagues about the experience, by position, then
            slug; the organization above is their context.
        created_at (datetime.datetime):
        updated_at (datetime.datetime):
    """

    id: UUID
    slug: str
    title: str
    kind: ExperienceKind
    started_on: datetime.date
    ended_on: datetime.date | None
    summary: str
    responsibilities: list[str]
    in_cv: bool
    organization: Organization
    technologies: list[Technology]
    projects: list[Project]
    testimonials: list[Testimonial]
    created_at: datetime.datetime
    updated_at: datetime.datetime

    def to_dict(self) -> dict[str, Any]:
        id = str(self.id)

        slug = self.slug

        title = self.title

        kind = self.kind.value

        started_on = self.started_on.isoformat()

        ended_on: None | str
        if isinstance(self.ended_on, datetime.date):
            ended_on = self.ended_on.isoformat()
        else:
            ended_on = self.ended_on

        summary = self.summary

        responsibilities = self.responsibilities

        in_cv = self.in_cv

        organization = self.organization.to_dict()

        technologies = []
        for technologies_item_data in self.technologies:
            technologies_item = technologies_item_data.to_dict()
            technologies.append(technologies_item)

        projects = []
        for projects_item_data in self.projects:
            projects_item = projects_item_data.to_dict()
            projects.append(projects_item)

        testimonials = []
        for testimonials_item_data in self.testimonials:
            testimonials_item = testimonials_item_data.to_dict()
            testimonials.append(testimonials_item)

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "slug": slug,
                "title": title,
                "kind": kind,
                "startedOn": started_on,
                "endedOn": ended_on,
                "summary": summary,
                "responsibilities": responsibilities,
                "inCv": in_cv,
                "organization": organization,
                "technologies": technologies,
                "projects": projects,
                "testimonials": testimonials,
                "createdAt": created_at,
                "updatedAt": updated_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.organization import Organization
        from ..models.project import Project
        from ..models.technology import Technology
        from ..models.testimonial import Testimonial

        d = dict(src_dict)
        id = UUID(d.pop("id"))

        slug = d.pop("slug")

        title = d.pop("title")

        kind = ExperienceKind(d.pop("kind"))

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

        summary = d.pop("summary")

        responsibilities = cast(list[str], d.pop("responsibilities"))

        in_cv = d.pop("inCv")

        organization = Organization.from_dict(d.pop("organization"))

        technologies = []
        _technologies = d.pop("technologies")
        for technologies_item_data in _technologies:
            technologies_item = Technology.from_dict(technologies_item_data)

            technologies.append(technologies_item)

        projects = []
        _projects = d.pop("projects")
        for projects_item_data in _projects:
            projects_item = Project.from_dict(projects_item_data)

            projects.append(projects_item)

        testimonials = []
        _testimonials = d.pop("testimonials")
        for testimonials_item_data in _testimonials:
            testimonials_item = Testimonial.from_dict(testimonials_item_data)

            testimonials.append(testimonials_item)

        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))

        updated_at = datetime.datetime.fromisoformat(d.pop("updatedAt"))

        experience = cls(
            id=id,
            slug=slug,
            title=title,
            kind=kind,
            started_on=started_on,
            ended_on=ended_on,
            summary=summary,
            responsibilities=responsibilities,
            in_cv=in_cv,
            organization=organization,
            technologies=technologies,
            projects=projects,
            testimonials=testimonials,
            created_at=created_at,
            updated_at=updated_at,
        )

        return experience
