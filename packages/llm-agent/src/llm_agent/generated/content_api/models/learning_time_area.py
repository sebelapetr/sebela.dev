from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.learning_time_module import LearningTimeModule


T = TypeVar("T", bound="LearningTimeArea")


@_attrs_define
class LearningTimeArea:
    """
    Attributes:
        slug (str): The stable, unique address of the record, for example `paldock`.
        name (str):
        total_seconds (int): Study time: resource and book time together, never event attendance.
        resource_seconds (int): Time logged on resources whose type is not `book`.
        book_seconds (int): Time logged on resources of type `book`, counted once.
        modules (list[LearningTimeModule]): The area's modules with study time, by total (largest first), then slug.
            Their totals sum to the area's.
    """

    slug: str
    name: str
    total_seconds: int
    resource_seconds: int
    book_seconds: int
    modules: list[LearningTimeModule]

    def to_dict(self) -> dict[str, Any]:
        slug = self.slug

        name = self.name

        total_seconds = self.total_seconds

        resource_seconds = self.resource_seconds

        book_seconds = self.book_seconds

        modules = []
        for modules_item_data in self.modules:
            modules_item = modules_item_data.to_dict()
            modules.append(modules_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "slug": slug,
                "name": name,
                "totalSeconds": total_seconds,
                "resourceSeconds": resource_seconds,
                "bookSeconds": book_seconds,
                "modules": modules,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.learning_time_module import LearningTimeModule

        d = dict(src_dict)
        slug = d.pop("slug")

        name = d.pop("name")

        total_seconds = d.pop("totalSeconds")

        resource_seconds = d.pop("resourceSeconds")

        book_seconds = d.pop("bookSeconds")

        modules = []
        _modules = d.pop("modules")
        for modules_item_data in _modules:
            modules_item = LearningTimeModule.from_dict(modules_item_data)

            modules.append(modules_item)

        learning_time_area = cls(
            slug=slug,
            name=name,
            total_seconds=total_seconds,
            resource_seconds=resource_seconds,
            book_seconds=book_seconds,
            modules=modules,
        )

        return learning_time_area
