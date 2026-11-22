from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

from ..models.chat_assistant_message_error_type_0_code import (
    ChatAssistantMessageErrorType0Code,
)

T = TypeVar("T", bound="ChatAssistantMessageErrorType0")


@_attrs_define
class ChatAssistantMessageErrorType0:
    """
    Attributes:
        code (ChatAssistantMessageErrorType0Code):
        retryable (bool):
    """

    code: ChatAssistantMessageErrorType0Code
    retryable: bool

    def to_dict(self) -> dict[str, Any]:
        code = self.code.value

        retryable = self.retryable

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "code": code,
                "retryable": retryable,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        code = ChatAssistantMessageErrorType0Code(d.pop("code"))

        retryable = d.pop("retryable")

        chat_assistant_message_error_type_0 = cls(
            code=code,
            retryable=retryable,
        )

        return chat_assistant_message_error_type_0
