from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="RoadmapSummary")


@_attrs_define
class RoadmapSummary:
    """
    Attributes:
        area_count (int):
        module_count (int):
        resource_count (int):
        completed (int): Resources with the status `completed`.
        total (int): All resources, whatever their status.
        estimated_minutes (int): The sum of every resource estimate; a missing estimate counts as zero.
        estimated_hours (int): `estimatedMinutes` divided by 60, rounded to the nearest whole hour.
        last_updated_at (datetime.datetime | None): The latest change of any resource; `null` when there are none.
    """

    area_count: int
    module_count: int
    resource_count: int
    completed: int
    total: int
    estimated_minutes: int
    estimated_hours: int
    last_updated_at: datetime.datetime | None

    def to_dict(self) -> dict[str, Any]:
        area_count = self.area_count

        module_count = self.module_count

        resource_count = self.resource_count

        completed = self.completed

        total = self.total

        estimated_minutes = self.estimated_minutes

        estimated_hours = self.estimated_hours

        last_updated_at: None | str
        if isinstance(self.last_updated_at, datetime.datetime):
            last_updated_at = self.last_updated_at.isoformat()
        else:
            last_updated_at = self.last_updated_at

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "areaCount": area_count,
                "moduleCount": module_count,
                "resourceCount": resource_count,
                "completed": completed,
                "total": total,
                "estimatedMinutes": estimated_minutes,
                "estimatedHours": estimated_hours,
                "lastUpdatedAt": last_updated_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        area_count = d.pop("areaCount")

        module_count = d.pop("moduleCount")

        resource_count = d.pop("resourceCount")

        completed = d.pop("completed")

        total = d.pop("total")

        estimated_minutes = d.pop("estimatedMinutes")

        estimated_hours = d.pop("estimatedHours")

        def _parse_last_updated_at(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                last_updated_at_type_0 = datetime.datetime.fromisoformat(data)

                return last_updated_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        last_updated_at = _parse_last_updated_at(d.pop("lastUpdatedAt"))

        roadmap_summary = cls(
            area_count=area_count,
            module_count=module_count,
            resource_count=resource_count,
            completed=completed,
            total=total,
            estimated_minutes=estimated_minutes,
            estimated_hours=estimated_hours,
            last_updated_at=last_updated_at,
        )

        return roadmap_summary
