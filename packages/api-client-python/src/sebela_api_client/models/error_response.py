from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.error_response_error import ErrorResponseError


T = TypeVar("T", bound="ErrorResponse")


@_attrs_define
class ErrorResponse:
    """The common error shape of every failed request.

    Attributes:
        error (ErrorResponseError):
    """

    error: ErrorResponseError

    def to_dict(self) -> dict[str, Any]:
        error = self.error.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "error": error,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.error_response_error import ErrorResponseError

        d = dict(src_dict)
        error = ErrorResponseError.from_dict(d.pop("error"))

        error_response = cls(
            error=error,
        )

        return error_response
