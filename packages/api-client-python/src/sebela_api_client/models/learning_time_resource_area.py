from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="LearningTimeResourceArea")


@_attrs_define
class LearningTimeResourceArea:
    """The area of that module.

    Attributes:
        slug (str): The stable, unique address of the record, for example `northwind-freight`.
        name (str):
    """

    slug: str
    name: str

    def to_dict(self) -> dict[str, Any]:
        slug = self.slug

        name = self.name

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "slug": slug,
                "name": name,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        slug = d.pop("slug")

        name = d.pop("name")

        learning_time_resource_area = cls(
            slug=slug,
            name=name,
        )

        return learning_time_resource_area
