from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="RoadmapProjectIdeaUpdate")


@_attrs_define
class RoadmapProjectIdeaUpdate:
    """
    Attributes:
        title (str | Unset):
        why_it_matters (str | Unset): Why the project is worth doing, Markdown.
        how_to_start (None | str | Unset): How to begin, Markdown; `null` when there is no advice yet.
        position (int | Unset): Ascending order in its list; ties are ordered by slug.
        topics (list[str] | Unset): Slugs of existing shared topics, each once, in their intended order. On an update
            the list replaces every link; an omitted list leaves them unchanged.
    """

    title: str | Unset = UNSET
    why_it_matters: str | Unset = UNSET
    how_to_start: None | str | Unset = UNSET
    position: int | Unset = UNSET
    topics: list[str] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        title = self.title

        why_it_matters = self.why_it_matters

        how_to_start: None | str | Unset
        if isinstance(self.how_to_start, Unset):
            how_to_start = UNSET
        else:
            how_to_start = self.how_to_start

        position = self.position

        topics: list[str] | Unset = UNSET
        if not isinstance(self.topics, Unset):
            topics = self.topics

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if title is not UNSET:
            field_dict["title"] = title
        if why_it_matters is not UNSET:
            field_dict["whyItMatters"] = why_it_matters
        if how_to_start is not UNSET:
            field_dict["howToStart"] = how_to_start
        if position is not UNSET:
            field_dict["position"] = position
        if topics is not UNSET:
            field_dict["topics"] = topics

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        title = d.pop("title", UNSET)

        why_it_matters = d.pop("whyItMatters", UNSET)

        def _parse_how_to_start(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        how_to_start = _parse_how_to_start(d.pop("howToStart", UNSET))

        position = d.pop("position", UNSET)

        topics = cast(list[str], d.pop("topics", UNSET))

        roadmap_project_idea_update = cls(
            title=title,
            why_it_matters=why_it_matters,
            how_to_start=how_to_start,
            position=position,
            topics=topics,
        )

        return roadmap_project_idea_update
