from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import (
    TYPE_CHECKING,
    Any,
    Literal,
    Self,
    TypeVar,
    cast,
)
from uuid import UUID

from attrs import define as _attrs_define

from ..models.chat_assistant_message_outcome_type_0 import (
    ChatAssistantMessageOutcomeType0,
)
from ..models.chat_assistant_message_status import ChatAssistantMessageStatus

if TYPE_CHECKING:
    from ..models.chat_assistant_message_error_type_0 import (
        ChatAssistantMessageErrorType0,
    )
    from ..models.chat_block_output_type_0 import ChatBlockOutputType0
    from ..models.chat_block_output_type_1 import ChatBlockOutputType1
    from ..models.chat_block_output_type_2 import ChatBlockOutputType2
    from ..models.chat_block_output_type_3 import ChatBlockOutputType3
    from ..models.chat_block_output_type_4 import ChatBlockOutputType4
    from ..models.chat_related_link_output import ChatRelatedLinkOutput
    from ..models.chat_source_output import ChatSourceOutput


T = TypeVar("T", bound="ChatAssistantMessage")


@_attrs_define
class ChatAssistantMessage:
    """
    Attributes:
        id (UUID):
        role (Literal['assistant']):
        request_id (UUID):
        status (ChatAssistantMessageStatus):
        outcome (ChatAssistantMessageOutcomeType0 | None):
        error (ChatAssistantMessageErrorType0 | None):
        text (None | str):
        blocks (list[ChatBlockOutputType0 | ChatBlockOutputType1 | ChatBlockOutputType2 | ChatBlockOutputType3 |
            ChatBlockOutputType4]):
        sources (list[ChatSourceOutput]):
        related (list[ChatRelatedLinkOutput]):
        model (None | str): The main model this answer was admitted for; kept after a configuration change. `null` when
            none was recorded.
        effort (None | str): The reasoning effort this answer was admitted for; `null` when none was recorded.
        created_at (datetime.datetime):
    """

    id: UUID
    role: Literal["assistant"]
    request_id: UUID
    status: ChatAssistantMessageStatus
    outcome: ChatAssistantMessageOutcomeType0 | None
    error: ChatAssistantMessageErrorType0 | None
    text: None | str
    blocks: list[
        ChatBlockOutputType0
        | ChatBlockOutputType1
        | ChatBlockOutputType2
        | ChatBlockOutputType3
        | ChatBlockOutputType4
    ]
    sources: list[ChatSourceOutput]
    related: list[ChatRelatedLinkOutput]
    model: None | str
    effort: None | str
    created_at: datetime.datetime

    def to_dict(self) -> dict[str, Any]:
        from ..models.chat_assistant_message_error_type_0 import (
            ChatAssistantMessageErrorType0,
        )
        from ..models.chat_block_output_type_0 import ChatBlockOutputType0
        from ..models.chat_block_output_type_1 import ChatBlockOutputType1
        from ..models.chat_block_output_type_2 import ChatBlockOutputType2
        from ..models.chat_block_output_type_3 import ChatBlockOutputType3

        id = str(self.id)

        role = self.role

        request_id = str(self.request_id)

        status = self.status.value

        outcome: None | str
        if isinstance(self.outcome, ChatAssistantMessageOutcomeType0):
            outcome = self.outcome.value
        else:
            outcome = self.outcome

        error: dict[str, Any] | None
        if isinstance(self.error, ChatAssistantMessageErrorType0):
            error = self.error.to_dict()
        else:
            error = self.error

        text: None | str
        text = self.text

        blocks = []
        for blocks_item_data in self.blocks:
            blocks_item: dict[str, Any]
            if (
                isinstance(blocks_item_data, ChatBlockOutputType0)
                or isinstance(blocks_item_data, ChatBlockOutputType1)
                or isinstance(blocks_item_data, ChatBlockOutputType2)
                or isinstance(blocks_item_data, ChatBlockOutputType3)
            ):
                blocks_item = blocks_item_data.to_dict()
            else:
                blocks_item = blocks_item_data.to_dict()

            blocks.append(blocks_item)

        sources = []
        for sources_item_data in self.sources:
            sources_item = sources_item_data.to_dict()
            sources.append(sources_item)

        related = []
        for related_item_data in self.related:
            related_item = related_item_data.to_dict()
            related.append(related_item)

        model: None | str
        model = self.model

        effort: None | str
        effort = self.effort

        created_at = self.created_at.isoformat()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "role": role,
                "requestId": request_id,
                "status": status,
                "outcome": outcome,
                "error": error,
                "text": text,
                "blocks": blocks,
                "sources": sources,
                "related": related,
                "model": model,
                "effort": effort,
                "createdAt": created_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.chat_assistant_message_error_type_0 import (
            ChatAssistantMessageErrorType0,
        )
        from ..models.chat_block_output_type_0 import ChatBlockOutputType0
        from ..models.chat_block_output_type_1 import ChatBlockOutputType1
        from ..models.chat_block_output_type_2 import ChatBlockOutputType2
        from ..models.chat_block_output_type_3 import ChatBlockOutputType3
        from ..models.chat_block_output_type_4 import ChatBlockOutputType4
        from ..models.chat_related_link_output import ChatRelatedLinkOutput
        from ..models.chat_source_output import ChatSourceOutput

        d = dict(src_dict)
        id = UUID(d.pop("id"))

        role = cast(Literal["assistant"], d.pop("role"))
        if role != "assistant":
            raise ValueError(f"role must match const 'assistant', got '{role}'")

        request_id = UUID(d.pop("requestId"))

        status = ChatAssistantMessageStatus(d.pop("status"))

        def _parse_outcome(data: object) -> ChatAssistantMessageOutcomeType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                outcome_type_0 = ChatAssistantMessageOutcomeType0(data)

                return outcome_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(ChatAssistantMessageOutcomeType0 | None, data)

        outcome = _parse_outcome(d.pop("outcome"))

        def _parse_error(data: object) -> ChatAssistantMessageErrorType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                error_type_0 = ChatAssistantMessageErrorType0.from_dict(data)

                return error_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(ChatAssistantMessageErrorType0 | None, data)

        error = _parse_error(d.pop("error"))

        def _parse_text(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        text = _parse_text(d.pop("text"))

        blocks = []
        _blocks = d.pop("blocks")
        for blocks_item_data in _blocks:

            def _parse_blocks_item(
                data: object,
            ) -> (
                ChatBlockOutputType0
                | ChatBlockOutputType1
                | ChatBlockOutputType2
                | ChatBlockOutputType3
                | ChatBlockOutputType4
            ):
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_chat_block_output_type_0 = (
                        ChatBlockOutputType0.from_dict(data)
                    )

                    return componentsschemas_chat_block_output_type_0
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_chat_block_output_type_1 = (
                        ChatBlockOutputType1.from_dict(data)
                    )

                    return componentsschemas_chat_block_output_type_1
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_chat_block_output_type_2 = (
                        ChatBlockOutputType2.from_dict(data)
                    )

                    return componentsschemas_chat_block_output_type_2
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_chat_block_output_type_3 = (
                        ChatBlockOutputType3.from_dict(data)
                    )

                    return componentsschemas_chat_block_output_type_3
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_chat_block_output_type_4 = (
                    ChatBlockOutputType4.from_dict(data)
                )

                return componentsschemas_chat_block_output_type_4

            blocks_item = _parse_blocks_item(blocks_item_data)

            blocks.append(blocks_item)

        sources = []
        _sources = d.pop("sources")
        for sources_item_data in _sources:
            sources_item = ChatSourceOutput.from_dict(sources_item_data)

            sources.append(sources_item)

        related = []
        _related = d.pop("related")
        for related_item_data in _related:
            related_item = ChatRelatedLinkOutput.from_dict(related_item_data)

            related.append(related_item)

        def _parse_model(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        model = _parse_model(d.pop("model"))

        def _parse_effort(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        effort = _parse_effort(d.pop("effort"))

        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))

        chat_assistant_message = cls(
            id=id,
            role=role,
            request_id=request_id,
            status=status,
            outcome=outcome,
            error=error,
            text=text,
            blocks=blocks,
            sources=sources,
            related=related,
            model=model,
            effort=effort,
            created_at=created_at,
        )

        return chat_assistant_message
