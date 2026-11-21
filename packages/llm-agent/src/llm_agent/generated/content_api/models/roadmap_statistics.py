from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.learning_time_area import LearningTimeArea
    from ..models.learning_time_day import LearningTimeDay
    from ..models.learning_time_event import LearningTimeEvent
    from ..models.learning_time_month import LearningTimeMonth
    from ..models.learning_time_resource import LearningTimeResource
    from ..models.learning_time_totals import LearningTimeTotals
    from ..models.learning_time_week import LearningTimeWeek


T = TypeVar("T", bound="RoadmapStatistics")


@_attrs_define
class RoadmapStatistics:
    """
    Attributes:
        totals (LearningTimeTotals):
        days (list[LearningTimeDay]): Every diary day with logged time, oldest first.
        weeks (list[LearningTimeWeek]): Every Monday-start week from the first to the last with logged time, oldest
            first; a week between them without time is present with zero seconds.
        months (list[LearningTimeMonth]): Every calendar month from the first to the last with logged time, oldest
            first; a month between them without time is present with zero seconds.
        areas (list[LearningTimeArea]): The areas with study time, by total (largest first), then slug. Resource and
            book time counts in the current module and area of its resource; event attendance is never part of an area.
        resources (list[LearningTimeResource]): The resources with logged time, by total (largest first), then slug.
        events (list[LearningTimeEvent]): The events with attendance, by total (largest first), then slug.
    """

    totals: LearningTimeTotals
    days: list[LearningTimeDay]
    weeks: list[LearningTimeWeek]
    months: list[LearningTimeMonth]
    areas: list[LearningTimeArea]
    resources: list[LearningTimeResource]
    events: list[LearningTimeEvent]

    def to_dict(self) -> dict[str, Any]:
        totals = self.totals.to_dict()

        days = []
        for days_item_data in self.days:
            days_item = days_item_data.to_dict()
            days.append(days_item)

        weeks = []
        for weeks_item_data in self.weeks:
            weeks_item = weeks_item_data.to_dict()
            weeks.append(weeks_item)

        months = []
        for months_item_data in self.months:
            months_item = months_item_data.to_dict()
            months.append(months_item)

        areas = []
        for areas_item_data in self.areas:
            areas_item = areas_item_data.to_dict()
            areas.append(areas_item)

        resources = []
        for resources_item_data in self.resources:
            resources_item = resources_item_data.to_dict()
            resources.append(resources_item)

        events = []
        for events_item_data in self.events:
            events_item = events_item_data.to_dict()
            events.append(events_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "totals": totals,
                "days": days,
                "weeks": weeks,
                "months": months,
                "areas": areas,
                "resources": resources,
                "events": events,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.learning_time_area import LearningTimeArea
        from ..models.learning_time_day import LearningTimeDay
        from ..models.learning_time_event import LearningTimeEvent
        from ..models.learning_time_month import LearningTimeMonth
        from ..models.learning_time_resource import LearningTimeResource
        from ..models.learning_time_totals import LearningTimeTotals
        from ..models.learning_time_week import LearningTimeWeek

        d = dict(src_dict)
        totals = LearningTimeTotals.from_dict(d.pop("totals"))

        days = []
        _days = d.pop("days")
        for days_item_data in _days:
            days_item = LearningTimeDay.from_dict(days_item_data)

            days.append(days_item)

        weeks = []
        _weeks = d.pop("weeks")
        for weeks_item_data in _weeks:
            weeks_item = LearningTimeWeek.from_dict(weeks_item_data)

            weeks.append(weeks_item)

        months = []
        _months = d.pop("months")
        for months_item_data in _months:
            months_item = LearningTimeMonth.from_dict(months_item_data)

            months.append(months_item)

        areas = []
        _areas = d.pop("areas")
        for areas_item_data in _areas:
            areas_item = LearningTimeArea.from_dict(areas_item_data)

            areas.append(areas_item)

        resources = []
        _resources = d.pop("resources")
        for resources_item_data in _resources:
            resources_item = LearningTimeResource.from_dict(resources_item_data)

            resources.append(resources_item)

        events = []
        _events = d.pop("events")
        for events_item_data in _events:
            events_item = LearningTimeEvent.from_dict(events_item_data)

            events.append(events_item)

        roadmap_statistics = cls(
            totals=totals,
            days=days,
            weeks=weeks,
            months=months,
            areas=areas,
            resources=resources,
            events=events,
        )

        return roadmap_statistics
