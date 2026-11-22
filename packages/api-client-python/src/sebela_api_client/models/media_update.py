from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="MediaUpdate")


@_attrs_define
class MediaUpdate:
    """
    Attributes:
        alt_text (None | str | Unset): Text that describes an image for people who cannot see it.
    """

    alt_text: None | str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        alt_text: None | str | Unset
        if isinstance(self.alt_text, Unset):
            alt_text = UNSET
        else:
            alt_text = self.alt_text

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if alt_text is not UNSET:
            field_dict["altText"] = alt_text

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)

        def _parse_alt_text(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        alt_text = _parse_alt_text(d.pop("altText", UNSET))

        media_update = cls(
            alt_text=alt_text,
        )

        return media_update
