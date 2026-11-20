from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="LearningTimeModule")


@_attrs_define
class LearningTimeModule:
    """
    Attributes:
        slug (str): The stable, unique address of the record, for example `paldock`.
        name (str):
        total_seconds (int): Study time: resource and book time together, never event attendance.
        resource_seconds (int): Time logged on resources whose type is not `book`.
        book_seconds (int): Time logged on resources of type `book`, counted once.
    """

    slug: str
    name: str
    total_seconds: int
    resource_seconds: int
    book_seconds: int

    def to_dict(self) -> dict[str, Any]:
        slug = self.slug

        name = self.name

        total_seconds = self.total_seconds

        resource_seconds = self.resource_seconds

        book_seconds = self.book_seconds

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "slug": slug,
                "name": name,
                "totalSeconds": total_seconds,
                "resourceSeconds": resource_seconds,
                "bookSeconds": book_seconds,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        slug = d.pop("slug")

        name = d.pop("name")

        total_seconds = d.pop("totalSeconds")

        resource_seconds = d.pop("resourceSeconds")

        book_seconds = d.pop("bookSeconds")

        learning_time_module = cls(
            slug=slug,
            name=name,
            total_seconds=total_seconds,
            resource_seconds=resource_seconds,
            book_seconds=book_seconds,
        )

        return learning_time_module
