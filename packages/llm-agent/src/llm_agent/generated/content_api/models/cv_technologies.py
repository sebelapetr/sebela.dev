from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.cv_technologies_primary import CvTechnologiesPrimary
    from ..models.technology import Technology


T = TypeVar("T", bound="CvTechnologies")


@_attrs_define
class CvTechnologies:
    """The technology catalog in its tiers and groups.

    Attributes:
        primary (CvTechnologiesPrimary):
        secondary (list[Technology]): The secondary technologies. In catalog order: position, then slug.
    """

    primary: CvTechnologiesPrimary
    secondary: list[Technology]

    def to_dict(self) -> dict[str, Any]:
        primary = self.primary.to_dict()

        secondary = []
        for secondary_item_data in self.secondary:
            secondary_item = secondary_item_data.to_dict()
            secondary.append(secondary_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "primary": primary,
                "secondary": secondary,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.cv_technologies_primary import CvTechnologiesPrimary
        from ..models.technology import Technology

        d = dict(src_dict)
        primary = CvTechnologiesPrimary.from_dict(d.pop("primary"))

        secondary = []
        _secondary = d.pop("secondary")
        for secondary_item_data in _secondary:
            secondary_item = Technology.from_dict(secondary_item_data)

            secondary.append(secondary_item)

        cv_technologies = cls(
            primary=primary,
            secondary=secondary,
        )

        return cv_technologies
