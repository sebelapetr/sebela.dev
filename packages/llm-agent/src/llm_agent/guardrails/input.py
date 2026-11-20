"""Deterministic handling of visitor input before any model sees it.

The question is wrapped as delimited visitor data; delimiter look-alikes inside it are neutralized
so the visitor cannot close the block. The language of fixed responses is detected without a model.
"""

from __future__ import annotations

import re

from llm_agent.schemas import Language

_CZECH_LETTERS = re.compile(r"[áčďéěíňóřšťúůýž]", re.IGNORECASE)
_CZECH_WORDS = frozenset(
    {
        "aby",
        "ale",
        "jak",
        "jaký",
        "jaké",
        "je",
        "jsi",
        "kde",
        "kdo",
        "kdy",
        "mi",
        "mě",
        "mít",
        "na",
        "nebo",
        "proč",
        "prosím",
        "se",
        "si",
        "ve",
        "za",
    }
)
_WORD = re.compile(r"\w+", re.UNICODE)
_DELIMITER = re.compile(r"<\s*/?\s*visitor_[a-z_]*\s*>", re.IGNORECASE)


def detect_language(question: str) -> Language:
    """Czech when the question uses Czech letters or several common Czech words, else English."""
    if _CZECH_LETTERS.search(question):
        return "cs"
    words = [word.casefold() for word in _WORD.findall(question)]
    czech = sum(word in _CZECH_WORDS for word in words)
    return "cs" if czech >= 2 else "en"


def visitor_block(question: str) -> str:
    """The question as untrusted, delimited visitor data."""
    neutralized = _DELIMITER.sub("[removed delimiter]", question)
    return f"<visitor_question>\n{neutralized}\n</visitor_question>"
