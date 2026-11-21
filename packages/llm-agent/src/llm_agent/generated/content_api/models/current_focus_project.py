from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="CurrentFocusProject")


@_attrs_define
class CurrentFocusProject:
    """
    Attributes:
        slug (str): The stable, unique address of the record, for example `paldock`.
        name (str):
        experience (str): The slug of the experience it belongs to.
    """

    slug: str
    name: str
    experience: str

    def to_dict(self) -> dict[str, Any]:
        slug = self.slug

        name = self.name

        experience = self.experience

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "slug": slug,
                "name": name,
                "experience": experience,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        slug = d.pop("slug")

        name = d.pop("name")

        experience = d.pop("experience")

        current_focus_project = cls(
            slug=slug,
            name=name,
            experience=experience,
        )

        return current_focus_project
