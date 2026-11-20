"""Conservative token estimates of serialized model input.

No tokenizer is shipped; the estimate over-counts on purpose (one token per two UTF-8 bytes, plus a
per-message overhead) so admission never under-reserves. Newer Claude tokenizers count more tokens
for the same text, and this bound stays above them for English and Czech prose.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping, Sequence
from typing import Any

from langchain_core.messages import BaseMessage

MESSAGE_OVERHEAD = 16
REQUEST_OVERHEAD = 64


def text_tokens(text: str) -> int:
    return -(-len(text.encode("utf-8")) // 2)


def json_tokens(value: Any) -> int:
    return text_tokens(json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str))


def message_tokens(messages: Sequence[BaseMessage]) -> int:
    total = REQUEST_OVERHEAD
    for message in messages:
        content = message.content
        total += MESSAGE_OVERHEAD
        total += text_tokens(content) if isinstance(content, str) else json_tokens(content)
        tool_calls = getattr(message, "tool_calls", None)
        if tool_calls:
            total += json_tokens(tool_calls)
    return total


def request_tokens(
    messages: Sequence[BaseMessage],
    tools: Iterable[Mapping[str, Any]] = (),
    schema: Mapping[str, Any] | None = None,
) -> int:
    total = message_tokens(messages)
    for tool in tools:
        total += json_tokens(tool)
    if schema is not None:
        total += json_tokens(schema)
    return total
