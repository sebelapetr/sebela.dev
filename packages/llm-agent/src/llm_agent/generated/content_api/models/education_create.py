from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define

from ..models.education_create_kind import EducationCreateKind
from ..types import UNSET, Unset

T = TypeVar("T", bound="EducationCreate")


@_attrs_define
class EducationCreate:
    """
    Attributes:
        slug (str): The stable, unique address of the record, for example `paldock`.
        kind (EducationCreateKind): `school` (a formal study programme), `course`, `certification` or `milestone` (any
            other learning achievement).
        title (str):
        position (int): Ascending order in the list; ties are ordered by slug.
        institution (None | str | Unset): The school, provider or issuer; `null` when there is none.
        started_on (datetime.date | None | Unset): The first day, an ISO date; `null` when only the day of completion is
            known, as for a certification awarded on one day.
        ended_on (datetime.date | None | Unset): The day of completion, an ISO date, not before the start; `null` with a
            start marks ongoing learning. At least one of `startedOn` and `endedOn` is set.
        description (None | str | Unset): Markdown; `null` when there is none.
    """

    slug: str
    kind: EducationCreateKind
    title: str
    position: int
    institution: None | str | Unset = UNSET
    started_on: datetime.date | None | Unset = UNSET
    ended_on: datetime.date | None | Unset = UNSET
    description: None | str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        slug = self.slug

        kind = self.kind.value

        title = self.title

        position = self.position

        institution: None | str | Unset
        if isinstance(self.institution, Unset):
            institution = UNSET
        else:
            institution = self.institution

        started_on: None | str | Unset
        if isinstance(self.started_on, Unset):
            started_on = UNSET
        elif isinstance(self.started_on, datetime.date):
            started_on = self.started_on.isoformat()
        else:
            started_on = self.started_on

        ended_on: None | str | Unset
        if isinstance(self.ended_on, Unset):
            ended_on = UNSET
        elif isinstance(self.ended_on, datetime.date):
            ended_on = self.ended_on.isoformat()
        else:
            ended_on = self.ended_on

        description: None | str | Unset
        if isinstance(self.description, Unset):
            description = UNSET
        else:
            description = self.description

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "slug": slug,
                "kind": kind,
                "title": title,
                "position": position,
            }
        )
        if institution is not UNSET:
            field_dict["institution"] = institution
        if started_on is not UNSET:
            field_dict["startedOn"] = started_on
        if ended_on is not UNSET:
            field_dict["endedOn"] = ended_on
        if description is not UNSET:
            field_dict["description"] = description

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        slug = d.pop("slug")

        kind = EducationCreateKind(d.pop("kind"))

        title = d.pop("title")

        position = d.pop("position")

        def _parse_institution(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        institution = _parse_institution(d.pop("institution", UNSET))

        def _parse_started_on(data: object) -> datetime.date | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                started_on_type_0 = datetime.date.fromisoformat(data)

                return started_on_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.date | None | Unset, data)

        started_on = _parse_started_on(d.pop("startedOn", UNSET))

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

        def _parse_description(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        description = _parse_description(d.pop("description", UNSET))

        education_create = cls(
            slug=slug,
            kind=kind,
            title=title,
            position=position,
            institution=institution,
            started_on=started_on,
            ended_on=ended_on,
            description=description,
        )

        return education_create
