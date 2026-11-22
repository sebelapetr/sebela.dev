from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.roadmap_current_module_progress import RoadmapCurrentModuleProgress


T = TypeVar("T", bound="RoadmapCurrentModule")


@_attrs_define
class RoadmapCurrentModule:
    """
    Attributes:
        id (UUID):
        slug (str): The stable, unique address of the record, for example `northwind-freight`.
        name (str):
        description (None | str): Markdown; `null` when there is none.
        position (int): Ascending order among its siblings; ties are ordered by slug.
        created_at (datetime.datetime):
        updated_at (datetime.datetime):
        progress (RoadmapCurrentModuleProgress):
    """

    id: UUID
    slug: str
    name: str
    description: None | str
    position: int
    created_at: datetime.datetime
    updated_at: datetime.datetime
    progress: RoadmapCurrentModuleProgress

    def to_dict(self) -> dict[str, Any]:
        id = str(self.id)

        slug = self.slug

        name = self.name

        description: None | str
        description = self.description

        position = self.position

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()

        progress = self.progress.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "slug": slug,
                "name": name,
                "description": description,
                "position": position,
                "createdAt": created_at,
                "updatedAt": updated_at,
                "progress": progress,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.roadmap_current_module_progress import (
            RoadmapCurrentModuleProgress,
        )

        d = dict(src_dict)
        id = UUID(d.pop("id"))

        slug = d.pop("slug")

        name = d.pop("name")

        def _parse_description(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        description = _parse_description(d.pop("description"))

        position = d.pop("position")

        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))

        updated_at = datetime.datetime.fromisoformat(d.pop("updatedAt"))

        progress = RoadmapCurrentModuleProgress.from_dict(d.pop("progress"))

        roadmap_current_module = cls(
            id=id,
            slug=slug,
            name=name,
            description=description,
            position=position,
            created_at=created_at,
            updated_at=updated_at,
            progress=progress,
        )

        return roadmap_current_module
