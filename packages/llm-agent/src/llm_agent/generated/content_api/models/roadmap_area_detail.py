from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.roadmap_tree_area import RoadmapTreeArea


T = TypeVar("T", bound="RoadmapAreaDetail")


@_attrs_define
class RoadmapAreaDetail:
    """The area node of the roadmap tree, with its modules and their resources.

    Attributes:
        area (RoadmapTreeArea):
    """

    area: RoadmapTreeArea

    def to_dict(self) -> dict[str, Any]:
        area = self.area.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "area": area,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.roadmap_tree_area import RoadmapTreeArea

        d = dict(src_dict)
        area = RoadmapTreeArea.from_dict(d.pop("area"))

        roadmap_area_detail = cls(
            area=area,
        )

        return roadmap_area_detail
