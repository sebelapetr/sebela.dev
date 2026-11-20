from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="LearningTimeResourceBookType0")


@_attrs_define
class LearningTimeResourceBookType0:
    """
    Attributes:
        slug (str): The stable, unique address of the record, for example `paldock`.
        title (str):
    """

    slug: str
    title: str

    def to_dict(self) -> dict[str, Any]:
        slug = self.slug

        title = self.title

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "slug": slug,
                "title": title,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        slug = d.pop("slug")

        title = d.pop("title")

        learning_time_resource_book_type_0 = cls(
            slug=slug,
            title=title,
        )

        return learning_time_resource_book_type_0
