from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="RoadmapFollowedSourceUpdate")


@_attrs_define
class RoadmapFollowedSourceUpdate:
    """
    Attributes:
        title (str | Unset):
        description (None | str | Unset): Markdown; `null` when there is none.
        link (None | str | Unset): An absolute `http` or `https` address; `null` when there is none.
        kind (str | Unset): A short label of what the source is, for example `newsletter`, `podcast` or `blog`; free
            text, shown as written.
        position (int | Unset): Ascending order in its list; ties are ordered by slug.
    """

    title: str | Unset = UNSET
    description: None | str | Unset = UNSET
    link: None | str | Unset = UNSET
    kind: str | Unset = UNSET
    position: int | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        title = self.title

        description: None | str | Unset
        if isinstance(self.description, Unset):
            description = UNSET
        else:
            description = self.description

        link: None | str | Unset
        if isinstance(self.link, Unset):
            link = UNSET
        else:
            link = self.link

        kind = self.kind

        position = self.position

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if title is not UNSET:
            field_dict["title"] = title
        if description is not UNSET:
            field_dict["description"] = description
        if link is not UNSET:
            field_dict["link"] = link
        if kind is not UNSET:
            field_dict["kind"] = kind
        if position is not UNSET:
            field_dict["position"] = position

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        title = d.pop("title", UNSET)

        def _parse_description(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        description = _parse_description(d.pop("description", UNSET))

        def _parse_link(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        link = _parse_link(d.pop("link", UNSET))

        kind = d.pop("kind", UNSET)

        position = d.pop("position", UNSET)

        roadmap_followed_source_update = cls(
            title=title,
            description=description,
            link=link,
            kind=kind,
            position=position,
        )

        return roadmap_followed_source_update
