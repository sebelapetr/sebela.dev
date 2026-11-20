from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="RoadmapProjectIdeaCreate")


@_attrs_define
class RoadmapProjectIdeaCreate:
    """
    Attributes:
        slug (str): The stable identity of the record and its anchor on the website.
        title (str):
        why_it_matters (str): Why the project is worth doing, Markdown.
        position (int): Ascending order in its list; ties are ordered by slug.
        how_to_start (None | str | Unset): How to begin, Markdown; `null` when there is no advice yet.
        topics (list[str] | Unset): Slugs of existing shared topics, each once, in their intended order. On an update
            the list replaces every link; an omitted list leaves them unchanged.
    """

    slug: str
    title: str
    why_it_matters: str
    position: int
    how_to_start: None | str | Unset = UNSET
    topics: list[str] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        slug = self.slug

        title = self.title

        why_it_matters = self.why_it_matters

        position = self.position

        how_to_start: None | str | Unset
        if isinstance(self.how_to_start, Unset):
            how_to_start = UNSET
        else:
            how_to_start = self.how_to_start

        topics: list[str] | Unset = UNSET
        if not isinstance(self.topics, Unset):
            topics = self.topics

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "slug": slug,
                "title": title,
                "whyItMatters": why_it_matters,
                "position": position,
            }
        )
        if how_to_start is not UNSET:
            field_dict["howToStart"] = how_to_start
        if topics is not UNSET:
            field_dict["topics"] = topics

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        slug = d.pop("slug")

        title = d.pop("title")

        why_it_matters = d.pop("whyItMatters")

        position = d.pop("position")

        def _parse_how_to_start(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        how_to_start = _parse_how_to_start(d.pop("howToStart", UNSET))

        topics = cast(list[str], d.pop("topics", UNSET))

        roadmap_project_idea_create = cls(
            slug=slug,
            title=title,
            why_it_matters=why_it_matters,
            position=position,
            how_to_start=how_to_start,
            topics=topics,
        )

        return roadmap_project_idea_create
