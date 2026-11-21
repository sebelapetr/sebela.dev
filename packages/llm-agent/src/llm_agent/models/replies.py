"""Reading a provider reply: its visible text and its stop reason; thinking is never read."""

from __future__ import annotations

from langchain_core.messages import BaseMessage


def reply_text(message: BaseMessage) -> str:
    content = message.content
    if isinstance(content, str):
        return content
    parts: list[str] = []
    for block in content:
        if isinstance(block, str):
            parts.append(block)
        elif isinstance(block, dict) and block.get("type") == "text":
            parts.append(str(block.get("text", "")))
    return "".join(parts)


def stop_reason(message: BaseMessage) -> str | None:
    reason = message.response_metadata.get("stop_reason")
    return str(reason) if reason is not None else None
