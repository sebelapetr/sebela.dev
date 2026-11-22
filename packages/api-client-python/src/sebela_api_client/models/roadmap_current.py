from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.roadmap_current_area import RoadmapCurrentArea


T = TypeVar("T", bound="RoadmapCurrent")


@_attrs_define
class RoadmapCurrent:
    """The areas and modules whose derived status is `in-progress`, in the order of the roadmap; empty when nothing is.

    Attributes:
        areas (list[RoadmapCurrentArea]):
    """

    areas: list[RoadmapCurrentArea]

    def to_dict(self) -> dict[str, Any]:
        areas = []
        for areas_item_data in self.areas:
            areas_item = areas_item_data.to_dict()
            areas.append(areas_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "areas": areas,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.roadmap_current_area import RoadmapCurrentArea

        d = dict(src_dict)
        areas = []
        _areas = d.pop("areas")
        for areas_item_data in _areas:
            areas_item = RoadmapCurrentArea.from_dict(areas_item_data)

            areas.append(areas_item)

        roadmap_current = cls(
            areas=areas,
        )

        return roadmap_current
