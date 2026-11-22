from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="RoadmapBookResource")


@_attrs_define
class RoadmapBookResource:
    """
    Attributes:
        slug (str): The stable, unique address of the record, for example `northwind-freight`.
        name (str):
        module (str): The slug of its module.
        area (str): The slug of its module's area.
    """

    slug: str
    name: str
    module: str
    area: str

    def to_dict(self) -> dict[str, Any]:
        slug = self.slug

        name = self.name

        module = self.module

        area = self.area

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "slug": slug,
                "name": name,
                "module": module,
                "area": area,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        slug = d.pop("slug")

        name = d.pop("name")

        module = d.pop("module")

        area = d.pop("area")

        roadmap_book_resource = cls(
            slug=slug,
            name=name,
            module=module,
            area=area,
        )

        return roadmap_book_resource
