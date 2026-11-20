from __future__ import annotations

from collections.abc import Mapping
from typing import (
    Any,
    Literal,
    Self,
    TypeVar,
    cast,
)

from attrs import define as _attrs_define

T = TypeVar("T", bound="AuthenticationCheck")


@_attrs_define
class AuthenticationCheck:
    """
    Attributes:
        status (Literal['authenticated']):
    """

    status: Literal["authenticated"]

    def to_dict(self) -> dict[str, Any]:
        status = self.status

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "status": status,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        status = cast(Literal["authenticated"], d.pop("status"))
        if status != "authenticated":
            raise ValueError(f"status must match const 'authenticated', got '{status}'")

        authentication_check = cls(
            status=status,
        )

        return authentication_check
