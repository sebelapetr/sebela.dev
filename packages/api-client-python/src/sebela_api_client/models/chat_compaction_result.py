from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast

from attrs import define as _attrs_define

from ..models.chat_compaction_result_outcome import ChatCompactionResultOutcome

if TYPE_CHECKING:
    from ..models.chat_compaction_result_usage import ChatCompactionResultUsage
    from ..models.chat_compaction_result_versions import ChatCompactionResultVersions
    from ..models.chat_context_summary import ChatContextSummary


T = TypeVar("T", bound="ChatCompactionResult")


@_attrs_define
class ChatCompactionResult:
    """
    Attributes:
        grant (str):
        outcome (ChatCompactionResultOutcome):
        reason (None | str):
        summary (ChatContextSummary | None):
        kept (int):
        summary_tokens (int):
        next_input_tokens (int | None): The estimate of the working context the next question carries (summary and kept
            exchanges only); `null` when not measured.
        usage (ChatCompactionResultUsage):
        versions (ChatCompactionResultVersions):
        latency_ms (int):
    """

    grant: str
    outcome: ChatCompactionResultOutcome
    reason: None | str
    summary: ChatContextSummary | None
    kept: int
    summary_tokens: int
    next_input_tokens: int | None
    usage: ChatCompactionResultUsage
    versions: ChatCompactionResultVersions
    latency_ms: int

    def to_dict(self) -> dict[str, Any]:
        from ..models.chat_context_summary import ChatContextSummary

        grant = self.grant

        outcome = self.outcome.value

        reason: None | str
        reason = self.reason

        summary: dict[str, Any] | None
        if isinstance(self.summary, ChatContextSummary):
            summary = self.summary.to_dict()
        else:
            summary = self.summary

        kept = self.kept

        summary_tokens = self.summary_tokens

        next_input_tokens: int | None
        next_input_tokens = self.next_input_tokens

        usage = self.usage.to_dict()

        versions = self.versions.to_dict()

        latency_ms = self.latency_ms

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "grant": grant,
                "outcome": outcome,
                "reason": reason,
                "summary": summary,
                "kept": kept,
                "summaryTokens": summary_tokens,
                "nextInputTokens": next_input_tokens,
                "usage": usage,
                "versions": versions,
                "latencyMs": latency_ms,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.chat_compaction_result_usage import ChatCompactionResultUsage
        from ..models.chat_compaction_result_versions import (
            ChatCompactionResultVersions,
        )
        from ..models.chat_context_summary import ChatContextSummary

        d = dict(src_dict)
        grant = d.pop("grant")

        outcome = ChatCompactionResultOutcome(d.pop("outcome"))

        def _parse_reason(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        reason = _parse_reason(d.pop("reason"))

        def _parse_summary(data: object) -> ChatContextSummary | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                summary_type_0 = ChatContextSummary.from_dict(data)

                return summary_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(ChatContextSummary | None, data)

        summary = _parse_summary(d.pop("summary"))

        kept = d.pop("kept")

        summary_tokens = d.pop("summaryTokens")

        def _parse_next_input_tokens(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        next_input_tokens = _parse_next_input_tokens(d.pop("nextInputTokens"))

        usage = ChatCompactionResultUsage.from_dict(d.pop("usage"))

        versions = ChatCompactionResultVersions.from_dict(d.pop("versions"))

        latency_ms = d.pop("latencyMs")

        chat_compaction_result = cls(
            grant=grant,
            outcome=outcome,
            reason=reason,
            summary=summary,
            kept=kept,
            summary_tokens=summary_tokens,
            next_input_tokens=next_input_tokens,
            usage=usage,
            versions=versions,
            latency_ms=latency_ms,
        )

        return chat_compaction_result
