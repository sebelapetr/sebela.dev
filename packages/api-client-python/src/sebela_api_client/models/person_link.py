from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PersonLink")


@_attrs_define
class PersonLink:
    """A link of the person, in its intended order.

    Attributes:
        label (str):
        url (str):
    """

    label: str
    url: str

    def to_dict(self) -> dict[str, Any]:
        label = self.label

        url = self.url

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "label": label,
                "url": url,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        label = d.pop("label")

        url = d.pop("url")

        person_link = cls(
            label=label,
            url=url,
        )

        return person_link
