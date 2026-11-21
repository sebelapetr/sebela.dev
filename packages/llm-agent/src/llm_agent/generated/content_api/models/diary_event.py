from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define

from ..models.diary_event_kind import DiaryEventKind

T = TypeVar("T", bound="DiaryEvent")


@_attrs_define
class DiaryEvent:
    """
    Attributes:
        slug (str): The stable, unique address of the record, for example `northwind-freight`.
        name (str):
        kind (DiaryEventKind):
        starts_on (datetime.date): The first day of the event, `YYYY-MM-DD` in Europe/Prague, inclusive.
        ends_on (datetime.date): The last day of the event, `YYYY-MM-DD` in Europe/Prague, inclusive and not before
            `startsOn`; equal to it for a single-day event.
        link (None | str): `null` when the event has no link.
    """

    slug: str
    name: str
    kind: DiaryEventKind
    starts_on: datetime.date
    ends_on: datetime.date
    link: None | str

    def to_dict(self) -> dict[str, Any]:
        slug = self.slug

        name = self.name

        kind = self.kind.value

        starts_on = self.starts_on.isoformat()

        ends_on = self.ends_on.isoformat()

        link: None | str
        link = self.link

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "slug": slug,
                "name": name,
                "kind": kind,
                "startsOn": starts_on,
                "endsOn": ends_on,
                "link": link,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        slug = d.pop("slug")

        name = d.pop("name")

        kind = DiaryEventKind(d.pop("kind"))

        starts_on = datetime.date.fromisoformat(d.pop("startsOn"))

        ends_on = datetime.date.fromisoformat(d.pop("endsOn"))

        def _parse_link(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        link = _parse_link(d.pop("link"))

        diary_event = cls(
            slug=slug,
            name=name,
            kind=kind,
            starts_on=starts_on,
            ends_on=ends_on,
            link=link,
        )

        return diary_event
