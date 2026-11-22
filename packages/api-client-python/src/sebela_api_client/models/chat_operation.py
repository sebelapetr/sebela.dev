from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

from ..models.chat_operation_kind import ChatOperationKind
from ..models.chat_operation_status import ChatOperationStatus

if TYPE_CHECKING:
    from ..models.chat_operation_compaction import ChatOperationCompaction


T = TypeVar("T", bound="ChatOperation")


@_attrs_define
class ChatOperation:
    """
    Attributes:
        operation_id (UUID):
        request_id (UUID):
        kind (ChatOperationKind):
        status (ChatOperationStatus):
        deadline_at (datetime.datetime): The absolute deadline; it is never extended.
        assistant_message_id (None | UUID): The answer this operation fills; `null` for a compaction.
        compaction (ChatOperationCompaction | None): A compaction's reported outcome; `null` for an answer and before a
            compaction reports.
    """

    operation_id: UUID
    request_id: UUID
    kind: ChatOperationKind
    status: ChatOperationStatus
    deadline_at: datetime.datetime
    assistant_message_id: None | UUID
    compaction: ChatOperationCompaction | None

    def to_dict(self) -> dict[str, Any]:
        from ..models.chat_operation_compaction import ChatOperationCompaction

        operation_id = str(self.operation_id)

        request_id = str(self.request_id)

        kind = self.kind.value

        status = self.status.value

        deadline_at = self.deadline_at.isoformat()

        assistant_message_id: None | str
        if isinstance(self.assistant_message_id, UUID):
            assistant_message_id = str(self.assistant_message_id)
        else:
            assistant_message_id = self.assistant_message_id

        compaction: dict[str, Any] | None
        if isinstance(self.compaction, ChatOperationCompaction):
            compaction = self.compaction.to_dict()
        else:
            compaction = self.compaction

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "operationId": operation_id,
                "requestId": request_id,
                "kind": kind,
                "status": status,
                "deadlineAt": deadline_at,
                "assistantMessageId": assistant_message_id,
                "compaction": compaction,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.chat_operation_compaction import ChatOperationCompaction

        d = dict(src_dict)
        operation_id = UUID(d.pop("operationId"))

        request_id = UUID(d.pop("requestId"))

        kind = ChatOperationKind(d.pop("kind"))

        status = ChatOperationStatus(d.pop("status"))

        deadline_at = datetime.datetime.fromisoformat(d.pop("deadlineAt"))

        def _parse_assistant_message_id(data: object) -> None | UUID:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                assistant_message_id_type_0 = UUID(data)

                return assistant_message_id_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | UUID, data)

        assistant_message_id = _parse_assistant_message_id(d.pop("assistantMessageId"))

        def _parse_compaction(data: object) -> ChatOperationCompaction | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                compaction_type_0 = ChatOperationCompaction.from_dict(data)

                return compaction_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(ChatOperationCompaction | None, data)

        compaction = _parse_compaction(d.pop("compaction"))

        chat_operation = cls(
            operation_id=operation_id,
            request_id=request_id,
            kind=kind,
            status=status,
            deadline_at=deadline_at,
            assistant_message_id=assistant_message_id,
            compaction=compaction,
        )

        return chat_operation
