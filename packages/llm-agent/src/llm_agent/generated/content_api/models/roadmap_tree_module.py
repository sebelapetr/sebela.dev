from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.roadmap_progress import RoadmapProgress
    from ..models.roadmap_tree_resource import RoadmapTreeResource


T = TypeVar("T", bound="RoadmapTreeModule")


@_attrs_define
class RoadmapTreeModule:
    """
    Attributes:
        id (UUID):
        slug (str): The stable, unique address of the record, for example `northwind-freight`.
        name (str):
        description (None | str): Markdown; `null` when there is none.
        position (int): Ascending order among its siblings; ties are ordered by slug.
        created_at (datetime.datetime):
        updated_at (datetime.datetime):
        progress (RoadmapProgress):
        resources (list[RoadmapTreeResource]):
    """

    id: UUID
    slug: str
    name: str
    description: None | str
    position: int
    created_at: datetime.datetime
    updated_at: datetime.datetime
    progress: RoadmapProgress
    resources: list[RoadmapTreeResource]

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

        resources = []
        for resources_item_data in self.resources:
            resources_item = resources_item_data.to_dict()
            resources.append(resources_item)

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
                "resources": resources,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.roadmap_progress import RoadmapProgress
        from ..models.roadmap_tree_resource import RoadmapTreeResource

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

        progress = RoadmapProgress.from_dict(d.pop("progress"))

        resources = []
        _resources = d.pop("resources")
        for resources_item_data in _resources:
            resources_item = RoadmapTreeResource.from_dict(resources_item_data)

            resources.append(resources_item)

        roadmap_tree_module = cls(
            id=id,
            slug=slug,
            name=name,
            description=description,
            position=position,
            created_at=created_at,
            updated_at=updated_at,
            progress=progress,
            resources=resources,
        )

        return roadmap_tree_module
