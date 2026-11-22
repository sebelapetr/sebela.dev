from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define

from ..models.roadmap_progress_status import RoadmapProgressStatus

T = TypeVar("T", bound="RoadmapProgress")


@_attrs_define
class RoadmapProgress:
    """
    Attributes:
        completed (int): Resources with the status `completed`.
        total (int): All resources, whatever their status.
        status (RoadmapProgressStatus): `planned` when empty; `completed` when every resource is completed or skipped;
            `in-progress` when any is in progress; otherwise `planned`. `in-progress` marks it current.
        completed_at (datetime.datetime | None): The latest finish among completed resources once the whole container is
            completed; `null` otherwise or when no completed resource has a finish.
        last_updated_at (datetime.datetime | None): The latest change of any of its resources; `null` when it has none.
        estimated_minutes (int): The sum of every resource estimate; a missing estimate counts as zero.
    """

    completed: int
    total: int
    status: RoadmapProgressStatus
    completed_at: datetime.datetime | None
    last_updated_at: datetime.datetime | None
    estimated_minutes: int

    def to_dict(self) -> dict[str, Any]:
        completed = self.completed

        total = self.total

        status = self.status.value

        completed_at: None | str
        if isinstance(self.completed_at, datetime.datetime):
            completed_at = self.completed_at.isoformat()
        else:
            completed_at = self.completed_at

        last_updated_at: None | str
        if isinstance(self.last_updated_at, datetime.datetime):
            last_updated_at = self.last_updated_at.isoformat()
        else:
            last_updated_at = self.last_updated_at

        estimated_minutes = self.estimated_minutes

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "completed": completed,
                "total": total,
                "status": status,
                "completedAt": completed_at,
                "lastUpdatedAt": last_updated_at,
                "estimatedMinutes": estimated_minutes,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        completed = d.pop("completed")

        total = d.pop("total")

        status = RoadmapProgressStatus(d.pop("status"))

        def _parse_completed_at(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                completed_at_type_0 = datetime.datetime.fromisoformat(data)

                return completed_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        completed_at = _parse_completed_at(d.pop("completedAt"))

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

        estimated_minutes = d.pop("estimatedMinutes")

        roadmap_progress = cls(
            completed=completed,
            total=total,
            status=status,
            completed_at=completed_at,
            last_updated_at=last_updated_at,
            estimated_minutes=estimated_minutes,
        )

        return roadmap_progress
