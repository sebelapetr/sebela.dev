from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define

from ..models.chat_conversation_cleared_telemetry_deletion import (
    ChatConversationClearedTelemetryDeletion,
)

if TYPE_CHECKING:
    from ..models.chat_conversation import ChatConversation


T = TypeVar("T", bound="ChatConversationCleared")


@_attrs_define
class ChatConversationCleared:
    """
    Attributes:
        cleared (bool):
        conversation (ChatConversation):
        telemetry_deletion (ChatConversationClearedTelemetryDeletion):
    """

    cleared: bool
    conversation: ChatConversation
    telemetry_deletion: ChatConversationClearedTelemetryDeletion

    def to_dict(self) -> dict[str, Any]:
        cleared = self.cleared

        conversation = self.conversation.to_dict()

        telemetry_deletion = self.telemetry_deletion.value

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "cleared": cleared,
                "conversation": conversation,
                "telemetryDeletion": telemetry_deletion,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.chat_conversation import ChatConversation

        d = dict(src_dict)
        cleared = d.pop("cleared")

        conversation = ChatConversation.from_dict(d.pop("conversation"))

        telemetry_deletion = ChatConversationClearedTelemetryDeletion(
            d.pop("telemetryDeletion")
        )

        chat_conversation_cleared = cls(
            cleared=cleared,
            conversation=conversation,
            telemetry_deletion=telemetry_deletion,
        )

        return chat_conversation_cleared
