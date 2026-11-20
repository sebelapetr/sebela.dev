from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define

from ..models.diary_resource_type import DiaryResourceType

T = TypeVar("T", bound="DiaryResource")


@_attrs_define
class DiaryResource:
    """
    Attributes:
        slug (str): The stable, unique address of the record, for example `paldock`.
        name (str):
        type_ (DiaryResourceType):
        link (None | str): `null` when the resource has no link.
        module (str): The slug of its module.
        area (str): The slug of its module's area.
    """

    slug: str
    name: str
    type_: DiaryResourceType
    link: None | str
    module: str
    area: str

    def to_dict(self) -> dict[str, Any]:
        slug = self.slug

        name = self.name

        type_ = self.type_.value

        link: None | str
        link = self.link

        module = self.module

        area = self.area

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "slug": slug,
                "name": name,
                "type": type_,
                "link": link,
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

        type_ = DiaryResourceType(d.pop("type"))

        def _parse_link(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        link = _parse_link(d.pop("link"))

        module = d.pop("module")

        area = d.pop("area")

        diary_resource = cls(
            slug=slug,
            name=name,
            type_=type_,
            link=link,
            module=module,
            area=area,
        )

        return diary_resource
