from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.roadmap_current_area_progress import RoadmapCurrentAreaProgress
    from ..models.roadmap_current_module import RoadmapCurrentModule


T = TypeVar("T", bound="RoadmapCurrentArea")


@_attrs_define
class RoadmapCurrentArea:
    """
    Attributes:
        id (UUID):
        slug (str): The stable, unique address of the record, for example `northwind-freight`.
        name (str):
        description (None | str): Markdown; `null` when there is none.
        weight (int): The recommended share of learning effort, 1 to 100. It is not progress and not logged time.
        position (int): Ascending order among its siblings; ties are ordered by slug.
        created_at (datetime.datetime):
        updated_at (datetime.datetime):
        progress (RoadmapCurrentAreaProgress):
        modules (list[RoadmapCurrentModule]):
    """

    id: UUID
    slug: str
    name: str
    description: None | str
    weight: int
    position: int
    created_at: datetime.datetime
    updated_at: datetime.datetime
    progress: RoadmapCurrentAreaProgress
    modules: list[RoadmapCurrentModule]

    def to_dict(self) -> dict[str, Any]:
        id = str(self.id)

        slug = self.slug

        name = self.name

        description: None | str
        description = self.description

        weight = self.weight

        position = self.position

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()

        progress = self.progress.to_dict()

        modules = []
        for modules_item_data in self.modules:
            modules_item = modules_item_data.to_dict()
            modules.append(modules_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "slug": slug,
                "name": name,
                "description": description,
                "weight": weight,
                "position": position,
                "createdAt": created_at,
                "updatedAt": updated_at,
                "progress": progress,
                "modules": modules,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.roadmap_current_area_progress import RoadmapCurrentAreaProgress
        from ..models.roadmap_current_module import RoadmapCurrentModule

        d = dict(src_dict)
        id = UUID(d.pop("id"))

        slug = d.pop("slug")

        name = d.pop("name")

        def _parse_description(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        description = _parse_description(d.pop("description"))

        weight = d.pop("weight")

        position = d.pop("position")

        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))

        updated_at = datetime.datetime.fromisoformat(d.pop("updatedAt"))

        progress = RoadmapCurrentAreaProgress.from_dict(d.pop("progress"))

        modules = []
        _modules = d.pop("modules")
        for modules_item_data in _modules:
            modules_item = RoadmapCurrentModule.from_dict(modules_item_data)

            modules.append(modules_item)

        roadmap_current_area = cls(
            id=id,
            slug=slug,
            name=name,
            description=description,
            weight=weight,
            position=position,
            created_at=created_at,
            updated_at=updated_at,
            progress=progress,
            modules=modules,
        )

        return roadmap_current_area
