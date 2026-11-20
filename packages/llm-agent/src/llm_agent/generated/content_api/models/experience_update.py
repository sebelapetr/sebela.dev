from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define

from ..models.experience_update_kind import ExperienceUpdateKind
from ..types import UNSET, Unset

T = TypeVar("T", bound="ExperienceUpdate")


@_attrs_define
class ExperienceUpdate:
    """
    Attributes:
        title (str | Unset):
        kind (ExperienceUpdateKind | Unset): A `main_job`, a `side_project` or an `own_business`.
        started_on (datetime.date | Unset): The first day of the role, an ISO date.
        ended_on (datetime.date | None | Unset): The last day of the role, an ISO date; `null` marks a current role.
        summary (str | Unset): Markdown.
        responsibilities (list[str] | Unset): Plain-text responsibilities, in their intended order.
        in_cv (bool | Unset): Whether the experience appears in the CV.
        organization (str | Unset): The slug of an existing organization.
        technologies (list[str] | Unset): Slugs of existing technologies, each once, in their intended order. On an
            update the list replaces every link; an omitted list leaves the links unchanged.
    """

    title: str | Unset = UNSET
    kind: ExperienceUpdateKind | Unset = UNSET
    started_on: datetime.date | Unset = UNSET
    ended_on: datetime.date | None | Unset = UNSET
    summary: str | Unset = UNSET
    responsibilities: list[str] | Unset = UNSET
    in_cv: bool | Unset = UNSET
    organization: str | Unset = UNSET
    technologies: list[str] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        title = self.title

        kind: str | Unset = UNSET
        if not isinstance(self.kind, Unset):
            kind = self.kind.value

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

        summary = self.summary

        responsibilities: list[str] | Unset = UNSET
        if not isinstance(self.responsibilities, Unset):
            responsibilities = self.responsibilities

        in_cv = self.in_cv

        organization = self.organization

        technologies: list[str] | Unset = UNSET
        if not isinstance(self.technologies, Unset):
            technologies = self.technologies

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if title is not UNSET:
            field_dict["title"] = title
        if kind is not UNSET:
            field_dict["kind"] = kind
        if started_on is not UNSET:
            field_dict["startedOn"] = started_on
        if ended_on is not UNSET:
            field_dict["endedOn"] = ended_on
        if summary is not UNSET:
            field_dict["summary"] = summary
        if responsibilities is not UNSET:
            field_dict["responsibilities"] = responsibilities
        if in_cv is not UNSET:
            field_dict["inCv"] = in_cv
        if organization is not UNSET:
            field_dict["organization"] = organization
        if technologies is not UNSET:
            field_dict["technologies"] = technologies

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        title = d.pop("title", UNSET)

        _kind = d.pop("kind", UNSET)
        kind: ExperienceUpdateKind | Unset
        if isinstance(_kind, Unset):
            kind = UNSET
        else:
            kind = ExperienceUpdateKind(_kind)

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

        summary = d.pop("summary", UNSET)

        responsibilities = cast(list[str], d.pop("responsibilities", UNSET))

        in_cv = d.pop("inCv", UNSET)

        organization = d.pop("organization", UNSET)

        technologies = cast(list[str], d.pop("technologies", UNSET))

        experience_update = cls(
            title=title,
            kind=kind,
            started_on=started_on,
            ended_on=ended_on,
            summary=summary,
            responsibilities=responsibilities,
            in_cv=in_cv,
            organization=organization,
            technologies=technologies,
        )

        return experience_update
