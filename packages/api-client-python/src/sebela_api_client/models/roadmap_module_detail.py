from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.roadmap_area import RoadmapArea
    from ..models.roadmap_tree_module import RoadmapTreeModule


T = TypeVar("T", bound="RoadmapModuleDetail")


@_attrs_define
class RoadmapModuleDetail:
    """The module node of the roadmap tree and the area that holds it.

    Attributes:
        area (RoadmapArea):
        module (RoadmapTreeModule):
    """

    area: RoadmapArea
    module: RoadmapTreeModule

    def to_dict(self) -> dict[str, Any]:
        area = self.area.to_dict()

        module = self.module.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "area": area,
                "module": module,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.roadmap_area import RoadmapArea
        from ..models.roadmap_tree_module import RoadmapTreeModule

        d = dict(src_dict)
        area = RoadmapArea.from_dict(d.pop("area"))

        module = RoadmapTreeModule.from_dict(d.pop("module"))

        roadmap_module_detail = cls(
            area=area,
            module=module,
        )

        return roadmap_module_detail
