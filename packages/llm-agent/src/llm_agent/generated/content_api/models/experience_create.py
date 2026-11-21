from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define

from ..models.experience_create_kind import ExperienceCreateKind
from ..types import UNSET, Unset

T = TypeVar("T", bound="ExperienceCreate")


@_attrs_define
class ExperienceCreate:
    """
    Attributes:
        slug (str): The stable, unique address of the record, for example `northwind-freight`.
        title (str):
        kind (ExperienceCreateKind): A `main_job`, a `side_project` or an `own_business`.
        started_on (datetime.date): The first day of the role, an ISO date.
        summary (str): Markdown.
        in_cv (bool): Whether the experience appears in the CV.
        organization (str): The slug of an existing organization.
        ended_on (datetime.date | None | Unset): The last day of the role, an ISO date; `null` marks a current role.
        responsibilities (list[str] | Unset): Plain-text responsibilities, in their intended order.
        technologies (list[str] | Unset): Slugs of existing technologies, each once, in their intended order. On an
            update the list replaces every link; an omitted list leaves the links unchanged.
    """

    slug: str
    title: str
    kind: ExperienceCreateKind
    started_on: datetime.date
    summary: str
    in_cv: bool
    organization: str
    ended_on: datetime.date | None | Unset = UNSET
    responsibilities: list[str] | Unset = UNSET
    technologies: list[str] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        slug = self.slug

        title = self.title

        kind = self.kind.value

        started_on = self.started_on.isoformat()

        summary = self.summary

        in_cv = self.in_cv

        organization = self.organization

        ended_on: None | str | Unset
        if isinstance(self.ended_on, Unset):
            ended_on = UNSET
        elif isinstance(self.ended_on, datetime.date):
            ended_on = self.ended_on.isoformat()
        else:
            ended_on = self.ended_on

        responsibilities: list[str] | Unset = UNSET
        if not isinstance(self.responsibilities, Unset):
            responsibilities = self.responsibilities

        technologies: list[str] | Unset = UNSET
        if not isinstance(self.technologies, Unset):
            technologies = self.technologies

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "slug": slug,
                "title": title,
                "kind": kind,
                "startedOn": started_on,
                "summary": summary,
                "inCv": in_cv,
                "organization": organization,
            }
        )
        if ended_on is not UNSET:
            field_dict["endedOn"] = ended_on
        if responsibilities is not UNSET:
            field_dict["responsibilities"] = responsibilities
        if technologies is not UNSET:
            field_dict["technologies"] = technologies

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        slug = d.pop("slug")

        title = d.pop("title")

        kind = ExperienceCreateKind(d.pop("kind"))

        started_on = datetime.date.fromisoformat(d.pop("startedOn"))

        summary = d.pop("summary")

        in_cv = d.pop("inCv")

        organization = d.pop("organization")

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

        responsibilities = cast(list[str], d.pop("responsibilities", UNSET))

        technologies = cast(list[str], d.pop("technologies", UNSET))

        experience_create = cls(
            slug=slug,
            title=title,
            kind=kind,
            started_on=started_on,
            summary=summary,
            in_cv=in_cv,
            organization=organization,
            ended_on=ended_on,
            responsibilities=responsibilities,
            technologies=technologies,
        )

        return experience_create
