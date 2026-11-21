"""The versioned system prompts of the two model stages."""

from __future__ import annotations

import hashlib

from llm_agent.prompts.chat import CHAT_PROMPT, UNCERTAIN_RESTRICTION
from llm_agent.prompts.security import SECURITY_PROMPT


def system_prompt_texts() -> tuple[str, ...]:
    """Every system text a model may receive; no line of them may reach a visitor."""
    return (SECURITY_PROMPT, CHAT_PROMPT, UNCERTAIN_RESTRICTION)


def fingerprint(*texts: str) -> str:
    return hashlib.sha256("\n\x00".join(texts).encode()).hexdigest()[:12]


__all__ = [
    "CHAT_PROMPT",
    "SECURITY_PROMPT",
    "UNCERTAIN_RESTRICTION",
    "fingerprint",
    "system_prompt_texts",
]
