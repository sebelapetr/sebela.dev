from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.roadmap_summary import RoadmapSummary
    from ..models.roadmap_tree_area import RoadmapTreeArea


T = TypeVar("T", bound="Roadmap")


@_attrs_define
class Roadmap:
    """Every level is ordered by position, then slug.

    Attributes:
        summary (RoadmapSummary):
        areas (list[RoadmapTreeArea]):
    """

    summary: RoadmapSummary
    areas: list[RoadmapTreeArea]

    def to_dict(self) -> dict[str, Any]:
        summary = self.summary.to_dict()

        areas = []
        for areas_item_data in self.areas:
            areas_item = areas_item_data.to_dict()
            areas.append(areas_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "summary": summary,
                "areas": areas,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.roadmap_summary import RoadmapSummary
        from ..models.roadmap_tree_area import RoadmapTreeArea

        d = dict(src_dict)
        summary = RoadmapSummary.from_dict(d.pop("summary"))

        areas = []
        _areas = d.pop("areas")
        for areas_item_data in _areas:
            areas_item = RoadmapTreeArea.from_dict(areas_item_data)

            areas.append(areas_item)

        roadmap = cls(
            summary=summary,
            areas=areas,
        )

        return roadmap
