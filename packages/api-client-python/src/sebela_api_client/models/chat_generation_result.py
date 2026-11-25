from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast

from attrs import define as _attrs_define

from ..models.chat_generation_result_language import ChatGenerationResultLanguage
from ..models.chat_generation_result_outcome import ChatGenerationResultOutcome
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.chat_block_type_0 import ChatBlockType0
    from ..models.chat_block_type_1 import ChatBlockType1
    from ..models.chat_block_type_2 import ChatBlockType2
    from ..models.chat_block_type_3 import ChatBlockType3
    from ..models.chat_block_type_4 import ChatBlockType4
    from ..models.chat_generation_result_context_type_0 import (
        ChatGenerationResultContextType0,
    )
    from ..models.chat_generation_result_usage import ChatGenerationResultUsage
    from ..models.chat_generation_result_versions import ChatGenerationResultVersions
    from ..models.chat_related_link import ChatRelatedLink
    from ..models.chat_source import ChatSource


T = TypeVar("T", bound="ChatGenerationResult")


@_attrs_define
class ChatGenerationResult:
    """
    Attributes:
        grant (str):
        outcome (ChatGenerationResultOutcome):
        reason (None | str):
        language (ChatGenerationResultLanguage):
        text (str):
        blocks (list[ChatBlockType0 | ChatBlockType1 | ChatBlockType2 | ChatBlockType3 | ChatBlockType4]):
        sources (list[ChatSource]):
        related (list[ChatRelatedLink]):
        usage (ChatGenerationResultUsage):
        versions (ChatGenerationResultVersions):
        latency_ms (int):
        context (ChatGenerationResultContextType0 | None | Unset):
    """

    grant: str
    outcome: ChatGenerationResultOutcome
    reason: None | str
    language: ChatGenerationResultLanguage
    text: str
    blocks: list[
        ChatBlockType0
        | ChatBlockType1
        | ChatBlockType2
        | ChatBlockType3
        | ChatBlockType4
    ]
    sources: list[ChatSource]
    related: list[ChatRelatedLink]
    usage: ChatGenerationResultUsage
    versions: ChatGenerationResultVersions
    latency_ms: int
    context: ChatGenerationResultContextType0 | None | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        from ..models.chat_block_type_0 import ChatBlockType0
        from ..models.chat_block_type_1 import ChatBlockType1
        from ..models.chat_block_type_2 import ChatBlockType2
        from ..models.chat_block_type_3 import ChatBlockType3
        from ..models.chat_generation_result_context_type_0 import (
            ChatGenerationResultContextType0,
        )

        grant = self.grant

        outcome = self.outcome.value

        reason: None | str
        reason = self.reason

        language = self.language.value

        text = self.text

        blocks = []
        for blocks_item_data in self.blocks:
            blocks_item: dict[str, Any]
            if (
                isinstance(blocks_item_data, ChatBlockType0)
                or isinstance(blocks_item_data, ChatBlockType1)
                or isinstance(blocks_item_data, ChatBlockType2)
                or isinstance(blocks_item_data, ChatBlockType3)
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

        usage = self.usage.to_dict()

        versions = self.versions.to_dict()

        latency_ms = self.latency_ms

        context: dict[str, Any] | None | Unset
        if isinstance(self.context, Unset):
            context = UNSET
        elif isinstance(self.context, ChatGenerationResultContextType0):
            context = self.context.to_dict()
        else:
            context = self.context

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "grant": grant,
                "outcome": outcome,
                "reason": reason,
                "language": language,
                "text": text,
                "blocks": blocks,
                "sources": sources,
                "related": related,
                "usage": usage,
                "versions": versions,
                "latencyMs": latency_ms,
            }
        )
        if context is not UNSET:
            field_dict["context"] = context

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.chat_block_type_0 import ChatBlockType0
        from ..models.chat_block_type_1 import ChatBlockType1
        from ..models.chat_block_type_2 import ChatBlockType2
        from ..models.chat_block_type_3 import ChatBlockType3
        from ..models.chat_block_type_4 import ChatBlockType4
        from ..models.chat_generation_result_context_type_0 import (
            ChatGenerationResultContextType0,
        )
        from ..models.chat_generation_result_usage import ChatGenerationResultUsage
        from ..models.chat_generation_result_versions import (
            ChatGenerationResultVersions,
        )
        from ..models.chat_related_link import ChatRelatedLink
        from ..models.chat_source import ChatSource

        d = dict(src_dict)
        grant = d.pop("grant")

        outcome = ChatGenerationResultOutcome(d.pop("outcome"))

        def _parse_reason(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        reason = _parse_reason(d.pop("reason"))

        language = ChatGenerationResultLanguage(d.pop("language"))

        text = d.pop("text")

        blocks = []
        _blocks = d.pop("blocks")
        for blocks_item_data in _blocks:

            def _parse_blocks_item(
                data: object,
            ) -> (
                ChatBlockType0
                | ChatBlockType1
                | ChatBlockType2
                | ChatBlockType3
                | ChatBlockType4
            ):
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_chat_block_type_0 = ChatBlockType0.from_dict(data)

                    return componentsschemas_chat_block_type_0
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_chat_block_type_1 = ChatBlockType1.from_dict(data)

                    return componentsschemas_chat_block_type_1
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_chat_block_type_2 = ChatBlockType2.from_dict(data)

                    return componentsschemas_chat_block_type_2
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_chat_block_type_3 = ChatBlockType3.from_dict(data)

                    return componentsschemas_chat_block_type_3
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_chat_block_type_4 = ChatBlockType4.from_dict(data)

                return componentsschemas_chat_block_type_4

            blocks_item = _parse_blocks_item(blocks_item_data)

            blocks.append(blocks_item)

        sources = []
        _sources = d.pop("sources")
        for sources_item_data in _sources:
            sources_item = ChatSource.from_dict(sources_item_data)

            sources.append(sources_item)

        related = []
        _related = d.pop("related")
        for related_item_data in _related:
            related_item = ChatRelatedLink.from_dict(related_item_data)

            related.append(related_item)

        usage = ChatGenerationResultUsage.from_dict(d.pop("usage"))

        versions = ChatGenerationResultVersions.from_dict(d.pop("versions"))

        latency_ms = d.pop("latencyMs")

        def _parse_context(
            data: object,
        ) -> ChatGenerationResultContextType0 | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                context_type_0 = ChatGenerationResultContextType0.from_dict(data)

                return context_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(ChatGenerationResultContextType0 | None | Unset, data)

        context = _parse_context(d.pop("context", UNSET))

        chat_generation_result = cls(
            grant=grant,
            outcome=outcome,
            reason=reason,
            language=language,
            text=text,
            blocks=blocks,
            sources=sources,
            related=related,
            usage=usage,
            versions=versions,
            latency_ms=latency_ms,
            context=context,
        )

        return chat_generation_result
