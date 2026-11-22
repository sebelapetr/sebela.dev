from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, Self, TypeVar
from uuid import UUID

from attrs import define as _attrs_define

from ..models.chat_operation_status import ChatOperationStatus

T = TypeVar("T", bound="ChatOperation")


@_attrs_define
class ChatOperation:
    """
    Attributes:
        operation_id (UUID):
        request_id (UUID):
        status (ChatOperationStatus):
        deadline_at (datetime.datetime): The absolute deadline; it is never extended.
        assistant_message_id (UUID):
    """

    operation_id: UUID
    request_id: UUID
    status: ChatOperationStatus
    deadline_at: datetime.datetime
    assistant_message_id: UUID

    def to_dict(self) -> dict[str, Any]:
        operation_id = str(self.operation_id)

        request_id = str(self.request_id)

        status = self.status.value

        deadline_at = self.deadline_at.isoformat()

        assistant_message_id = str(self.assistant_message_id)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "operationId": operation_id,
                "requestId": request_id,
                "status": status,
                "deadlineAt": deadline_at,
                "assistantMessageId": assistant_message_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        operation_id = UUID(d.pop("operationId"))

        request_id = UUID(d.pop("requestId"))

        status = ChatOperationStatus(d.pop("status"))

        deadline_at = datetime.datetime.fromisoformat(d.pop("deadlineAt"))

        assistant_message_id = UUID(d.pop("assistantMessageId"))

        chat_operation = cls(
            operation_id=operation_id,
            request_id=request_id,
            status=status,
            deadline_at=deadline_at,
            assistant_message_id=assistant_message_id,
        )

        return chat_operation
