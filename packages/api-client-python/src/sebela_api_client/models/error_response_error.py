from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define

from ..models.error_response_error_code import ErrorResponseErrorCode
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.error_field import ErrorField


T = TypeVar("T", bound="ErrorResponseError")


@_attrs_define
class ErrorResponseError:
    """
    Attributes:
        code (ErrorResponseErrorCode):
        message (str):
        fields (list[ErrorField] | Unset):
    """

    code: ErrorResponseErrorCode
    message: str
    fields: list[ErrorField] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        code = self.code.value

        message = self.message

        fields: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.fields, Unset):
            fields = []
            for fields_item_data in self.fields:
                fields_item = fields_item_data.to_dict()
                fields.append(fields_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "code": code,
                "message": message,
            }
        )
        if fields is not UNSET:
            field_dict["fields"] = fields

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.error_field import ErrorField

        d = dict(src_dict)
        code = ErrorResponseErrorCode(d.pop("code"))

        message = d.pop("message")

        _fields = d.pop("fields", UNSET)
        fields: list[ErrorField] | Unset = UNSET
        if _fields is not UNSET:
            fields = []
            for fields_item_data in _fields:
                fields_item = ErrorField.from_dict(fields_item_data)

                fields.append(fields_item)

        error_response_error = cls(
            code=code,
            message=message,
            fields=fields,
        )

        return error_response_error
