from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast

from attrs import define as _attrs_define

from ..models.learning_time_resource_category import LearningTimeResourceCategory
from ..models.learning_time_resource_type import LearningTimeResourceType

if TYPE_CHECKING:
    from ..models.learning_time_resource_area import LearningTimeResourceArea
    from ..models.learning_time_resource_book_type_0 import (
        LearningTimeResourceBookType0,
    )
    from ..models.learning_time_resource_module import LearningTimeResourceModule


T = TypeVar("T", bound="LearningTimeResource")


@_attrs_define
class LearningTimeResource:
    """
    Attributes:
        slug (str): The stable, unique address of the record, for example `paldock`.
        name (str):
        type_ (LearningTimeResourceType):
        category (LearningTimeResourceCategory): `book` for a resource of type `book`, otherwise `resource`.
        module (LearningTimeResourceModule): The module the resource is in now.
        area (LearningTimeResourceArea): The area of that module.
        book (LearningTimeResourceBookType0 | None): The book the resource reads; `null` when it links none.
        total_seconds (int): Time logged on the resource.
    """

    slug: str
    name: str
    type_: LearningTimeResourceType
    category: LearningTimeResourceCategory
    module: LearningTimeResourceModule
    area: LearningTimeResourceArea
    book: LearningTimeResourceBookType0 | None
    total_seconds: int

    def to_dict(self) -> dict[str, Any]:
        from ..models.learning_time_resource_book_type_0 import (
            LearningTimeResourceBookType0,
        )

        slug = self.slug

        name = self.name

        type_ = self.type_.value

        category = self.category.value

        module = self.module.to_dict()

        area = self.area.to_dict()

        book: dict[str, Any] | None
        if isinstance(self.book, LearningTimeResourceBookType0):
            book = self.book.to_dict()
        else:
            book = self.book

        total_seconds = self.total_seconds

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "slug": slug,
                "name": name,
                "type": type_,
                "category": category,
                "module": module,
                "area": area,
                "book": book,
                "totalSeconds": total_seconds,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.learning_time_resource_area import LearningTimeResourceArea
        from ..models.learning_time_resource_book_type_0 import (
            LearningTimeResourceBookType0,
        )
        from ..models.learning_time_resource_module import LearningTimeResourceModule

        d = dict(src_dict)
        slug = d.pop("slug")

        name = d.pop("name")

        type_ = LearningTimeResourceType(d.pop("type"))

        category = LearningTimeResourceCategory(d.pop("category"))

        module = LearningTimeResourceModule.from_dict(d.pop("module"))

        area = LearningTimeResourceArea.from_dict(d.pop("area"))

        def _parse_book(data: object) -> LearningTimeResourceBookType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                book_type_0 = LearningTimeResourceBookType0.from_dict(data)

                return book_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(LearningTimeResourceBookType0 | None, data)

        book = _parse_book(d.pop("book"))

        total_seconds = d.pop("totalSeconds")

        learning_time_resource = cls(
            slug=slug,
            name=name,
            type_=type_,
            category=category,
            module=module,
            area=area,
            book=book,
            total_seconds=total_seconds,
        )

        return learning_time_resource
