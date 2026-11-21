from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

T = TypeVar("T", bound="RoadmapModule")


@_attrs_define
class RoadmapModule:
    """
    Attributes:
        id (UUID):
        slug (str): The stable, unique address of the record, for example `paldock`.
        area (str): The slug of the area it belongs to.
        name (str):
        description (None | str): Markdown; `null` when there is none.
        position (int): Ascending order among its siblings; ties are ordered by slug.
        created_at (datetime.datetime):
        updated_at (datetime.datetime):
    """

    id: UUID
    slug: str
    area: str
    name: str
    description: None | str
    position: int
    created_at: datetime.datetime
    updated_at: datetime.datetime

    def to_dict(self) -> dict[str, Any]:
        id = str(self.id)

        slug = self.slug

        area = self.area

        name = self.name

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
                "area": area,
                "name": name,
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

        area = d.pop("area")

        name = d.pop("name")

        def _parse_description(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        description = _parse_description(d.pop("description"))

        position = d.pop("position")

        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))

        updated_at = datetime.datetime.fromisoformat(d.pop("updatedAt"))

        roadmap_module = cls(
            id=id,
            slug=slug,
            area=area,
            name=name,
            description=description,
            position=position,
            created_at=created_at,
            updated_at=updated_at,
        )

        return roadmap_module
