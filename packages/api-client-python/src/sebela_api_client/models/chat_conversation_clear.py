from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar
from uuid import UUID

from attrs import define as _attrs_define

T = TypeVar("T", bound="ChatConversationClear")


@_attrs_define
class ChatConversationClear:
    """
    Attributes:
        conversation_id (UUID): The conversation the visitor confirmed clearing; must be the current one.
    """

    conversation_id: UUID

    def to_dict(self) -> dict[str, Any]:
        conversation_id = str(self.conversation_id)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "conversationId": conversation_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        conversation_id = UUID(d.pop("conversationId"))

        chat_conversation_clear = cls(
            conversation_id=conversation_id,
        )

        return chat_conversation_clear
