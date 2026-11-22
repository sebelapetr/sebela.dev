from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.chat_assistant_message import ChatAssistantMessage
    from ..models.chat_operation import ChatOperation
    from ..models.chat_user_message import ChatUserMessage


T = TypeVar("T", bound="ChatConversation")


@_attrs_define
class ChatConversation:
    """
    Attributes:
        conversation_id (UUID):
        messages (list[ChatAssistantMessage | ChatUserMessage]):
        next_cursor (None | UUID): Pass as `before` to read older messages; `null` when there are none.
        active_operation (ChatOperation | None):
        retention_days (int): The conversation is deleted this many days after its last activity.
    """

    conversation_id: UUID
    messages: list[ChatAssistantMessage | ChatUserMessage]
    next_cursor: None | UUID
    active_operation: ChatOperation | None
    retention_days: int

    def to_dict(self) -> dict[str, Any]:
        from ..models.chat_operation import ChatOperation
        from ..models.chat_user_message import ChatUserMessage

        conversation_id = str(self.conversation_id)

        messages = []
        for messages_item_data in self.messages:
            messages_item: dict[str, Any]
            if isinstance(messages_item_data, ChatUserMessage):
                messages_item = messages_item_data.to_dict()
            else:
                messages_item = messages_item_data.to_dict()

            messages.append(messages_item)

        next_cursor: None | str
        if isinstance(self.next_cursor, UUID):
            next_cursor = str(self.next_cursor)
        else:
            next_cursor = self.next_cursor

        active_operation: dict[str, Any] | None
        if isinstance(self.active_operation, ChatOperation):
            active_operation = self.active_operation.to_dict()
        else:
            active_operation = self.active_operation

        retention_days = self.retention_days

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "conversationId": conversation_id,
                "messages": messages,
                "nextCursor": next_cursor,
                "activeOperation": active_operation,
                "retentionDays": retention_days,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.chat_assistant_message import ChatAssistantMessage
        from ..models.chat_operation import ChatOperation
        from ..models.chat_user_message import ChatUserMessage

        d = dict(src_dict)
        conversation_id = UUID(d.pop("conversationId"))

        messages = []
        _messages = d.pop("messages")
        for messages_item_data in _messages:

            def _parse_messages_item(
                data: object,
            ) -> ChatAssistantMessage | ChatUserMessage:
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_chat_message_type_0 = ChatUserMessage.from_dict(
                        data
                    )

                    return componentsschemas_chat_message_type_0
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_chat_message_type_1 = ChatAssistantMessage.from_dict(
                    data
                )

                return componentsschemas_chat_message_type_1

            messages_item = _parse_messages_item(messages_item_data)

            messages.append(messages_item)

        def _parse_next_cursor(data: object) -> None | UUID:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                next_cursor_type_0 = UUID(data)

                return next_cursor_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | UUID, data)

        next_cursor = _parse_next_cursor(d.pop("nextCursor"))

        def _parse_active_operation(data: object) -> ChatOperation | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                active_operation_type_0 = ChatOperation.from_dict(data)

                return active_operation_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(ChatOperation | None, data)

        active_operation = _parse_active_operation(d.pop("activeOperation"))

        retention_days = d.pop("retentionDays")

        chat_conversation = cls(
            conversation_id=conversation_id,
            messages=messages,
            next_cursor=next_cursor,
            active_operation=active_operation,
            retention_days=retention_days,
        )

        return chat_conversation
