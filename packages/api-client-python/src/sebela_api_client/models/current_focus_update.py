from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="CurrentFocusUpdate")


@_attrs_define
class CurrentFocusUpdate:
    """
    Attributes:
        title (str | Unset): What is being worked on or learned now.
        description (str | Unset): Markdown.
        link (None | str | Unset): An absolute `http` or `https` address with more about the focus; `null` when there is
            none.
        position (int | Unset): Ascending order in the list; ties are ordered by slug.
        project (None | str | Unset): The slug of an existing project the focus is about, or `null` for none. On an
            update a slug replaces the project, `null` removes it and an omitted field keeps it.
        topics (list[str] | Unset): Slugs of existing topics, each once, in their intended order. On an update the list
            replaces every link (an empty list removes them); an omitted list leaves them unchanged.
    """

    title: str | Unset = UNSET
    description: str | Unset = UNSET
    link: None | str | Unset = UNSET
    position: int | Unset = UNSET
    project: None | str | Unset = UNSET
    topics: list[str] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        title = self.title

        description = self.description

        link: None | str | Unset
        if isinstance(self.link, Unset):
            link = UNSET
        else:
            link = self.link

        position = self.position

        project: None | str | Unset
        if isinstance(self.project, Unset):
            project = UNSET
        else:
            project = self.project

        topics: list[str] | Unset = UNSET
        if not isinstance(self.topics, Unset):
            topics = self.topics

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if title is not UNSET:
            field_dict["title"] = title
        if description is not UNSET:
            field_dict["description"] = description
        if link is not UNSET:
            field_dict["link"] = link
        if position is not UNSET:
            field_dict["position"] = position
        if project is not UNSET:
            field_dict["project"] = project
        if topics is not UNSET:
            field_dict["topics"] = topics

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        title = d.pop("title", UNSET)

        description = d.pop("description", UNSET)

        def _parse_link(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        link = _parse_link(d.pop("link", UNSET))

        position = d.pop("position", UNSET)

        def _parse_project(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        project = _parse_project(d.pop("project", UNSET))

        topics = cast(list[str], d.pop("topics", UNSET))

        current_focus_update = cls(
            title=title,
            description=description,
            link=link,
            position=position,
            project=project,
            topics=topics,
        )

        return current_focus_update
