from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

from ..models.education_kind import EducationKind

T = TypeVar("T", bound="Education")


@_attrs_define
class Education:
    """
    Attributes:
        id (UUID):
        slug (str): The stable, unique address of the record, for example `northwind-freight`.
        kind (EducationKind): `school` (a formal study programme), `course`, `certification` or `milestone` (any other
            learning achievement).
        title (str):
        institution (None | str): The school, provider or issuer; `null` when there is none.
        started_on (datetime.date | None): The first day, an ISO date; `null` when only the day of completion is known,
            as for a certification awarded on one day.
        ended_on (datetime.date | None): The day of completion, an ISO date, not before the start; `null` with a start
            marks ongoing learning. At least one of `startedOn` and `endedOn` is set.
        description (None | str): Markdown; `null` when there is none.
        position (int): Ascending order in the list; ties are ordered by slug.
        created_at (datetime.datetime):
        updated_at (datetime.datetime):
    """

    id: UUID
    slug: str
    kind: EducationKind
    title: str
    institution: None | str
    started_on: datetime.date | None
    ended_on: datetime.date | None
    description: None | str
    position: int
    created_at: datetime.datetime
    updated_at: datetime.datetime

    def to_dict(self) -> dict[str, Any]:
        id = str(self.id)

        slug = self.slug

        kind = self.kind.value

        title = self.title

        institution: None | str
        institution = self.institution

        started_on: None | str
        if isinstance(self.started_on, datetime.date):
            started_on = self.started_on.isoformat()
        else:
            started_on = self.started_on

        ended_on: None | str
        if isinstance(self.ended_on, datetime.date):
            ended_on = self.ended_on.isoformat()
        else:
            ended_on = self.ended_on

        description: None | str
        description = self.description

        position = self.position

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "slug": slug,
                "kind": kind,
                "title": title,
                "institution": institution,
                "startedOn": started_on,
                "endedOn": ended_on,
                "description": description,
                "position": position,
                "createdAt": created_at,
                "updatedAt": updated_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        id = UUID(d.pop("id"))

        slug = d.pop("slug")

        kind = EducationKind(d.pop("kind"))

        title = d.pop("title")

        def _parse_institution(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        institution = _parse_institution(d.pop("institution"))

        def _parse_started_on(data: object) -> datetime.date | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                started_on_type_0 = datetime.date.fromisoformat(data)

                return started_on_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.date | None, data)

        started_on = _parse_started_on(d.pop("startedOn"))

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

        def _parse_description(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        description = _parse_description(d.pop("description"))

        position = d.pop("position")

        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))

        updated_at = datetime.datetime.fromisoformat(d.pop("updatedAt"))

        education = cls(
            id=id,
            slug=slug,
            kind=kind,
            title=title,
            institution=institution,
            started_on=started_on,
            ended_on=ended_on,
            description=description,
            position=position,
            created_at=created_at,
            updated_at=updated_at,
        )

        return education
