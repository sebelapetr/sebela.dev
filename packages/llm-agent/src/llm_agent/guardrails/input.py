"""Deterministic handling of visitor input before any model sees it.

The question is wrapped as delimited visitor data; delimiter look-alikes inside it (with or without
attributes) are neutralized so the visitor cannot close the block. The language of the turn is
chosen without a model: an explicit EN/CS switch, else the question's own language, else the
language of the newest earlier exchange, else English.
"""

from __future__ import annotations

import re
from collections.abc import Sequence

from llm_agent.schemas import ChatExchange, Language

_CZECH_LETTERS = re.compile(r"[áčďéěíňóřšťúůýž]", re.IGNORECASE)
_CZECH_WORDS = frozenset(
    {
        "aby",
        "ale",
        "byl",
        "byla",
        "co",
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
        "potom",
        "proč",
        "prosím",
        "se",
        "si",
        "ve",
        "za",
    }
)
_WORD = re.compile(r"\w+", re.UNICODE)
_DELIMITER = re.compile(r"<\s*/?\s*visitor_[a-z_]*\b[^>]*>", re.IGNORECASE)
#: Common English words that do not occur as Czech words ("a", "i", "on" and "to" do).
_ENGLISH_WORDS = frozenset(
    {
        "about",
        "and",
        "are",
        "can",
        "could",
        "did",
        "does",
        "for",
        "has",
        "have",
        "her",
        "how",
        "is",
        "me",
        "of",
        "she",
        "tell",
        "the",
        "there",
        "was",
        "what",
        "when",
        "where",
        "which",
        "who",
        "why",
        "with",
        "you",
    }
)
_EN_TARGETS: dict[str, Language] = {"english": "en", "czech": "cs"}
#: An English instruction to answer in a language: "answer in Czech", "switch to English".
_EN_SWITCH = re.compile(
    r"(?:^|[.!?,;:]\s*|\b(?:you|please|now|and)\s+)"
    r"(?:answer|reply|respond|write|continue|speak|talk|switch)"
    r"(?:\s+(?:back|to\s+me|me|only|please))*\s+(?:in|to|into)\s+(english|czech)\b",
    re.IGNORECASE,
)
_CS_TARGETS: dict[str, Language] = {
    "anglicky": "en",
    "v angličtině": "en",
    "po anglicku": "en",
    "angličtinou": "en",
    "na angličtinu": "en",
    "česky": "cs",
    "v češtině": "cs",
    "po česku": "cs",
    "češtinou": "cs",
    "na češtinu": "cs",
}
#: A Czech imperative to answer in a language: "odpovídej anglicky", "přepni na češtinu".
_CS_SWITCH = re.compile(
    r"\b(?:odpovídej|odpověz|piš|napiš|mluv|pokračuj|přepni)(?:te)?\b"
    r"(?:\s+[\w,]+){0,3}?\s+(" + "|".join(sorted(_CS_TARGETS, key=len, reverse=True)) + r")\b",
    re.IGNORECASE,
)


def detect_language(question: str) -> Language:
    """Czech when the question uses Czech letters or several common Czech words, else English."""
    if _CZECH_LETTERS.search(question):
        return "cs"
    words = [word.casefold() for word in _WORD.findall(question)]
    czech = sum(word in _CZECH_WORDS for word in words)
    return "cs" if czech >= 2 else "en"


def select_language(question: str, history: Sequence[ChatExchange] = ()) -> Language:
    """The language of this turn.

    An explicit switch in the question wins (the last one when there are several). Otherwise a
    question that is recognisably Czech or English sets the language, and an ambiguous short
    follow-up ("Brindle Labs?") inherits the newest earlier exchange's language, initially English.
    """
    switch = _switch(question)
    if switch is not None:
        return switch
    if detect_language(question) == "cs":
        return "cs"
    words = [word.casefold() for word in _WORD.findall(question)]
    if sum(word in _ENGLISH_WORDS for word in words) >= 2 or not history:
        return "en"
    return history[-1].language


def _switch(question: str) -> Language | None:
    found: list[tuple[int, Language]] = [
        (match.start(1), _EN_TARGETS[match.group(1).casefold()])
        for match in _EN_SWITCH.finditer(question)
    ]
    found += [
        (match.start(1), _CS_TARGETS[match.group(1).casefold()])
        for match in _CS_SWITCH.finditer(question)
    ]
    return max(found)[1] if found else None


def neutralized(text: str) -> str:
    """Visitor text in which no delimiter look-alike survives."""
    return _DELIMITER.sub("[removed delimiter]", text)


def visitor_block(question: str) -> str:
    """The question as untrusted, delimited visitor data."""
    return f"<visitor_question>\n{neutralized(question)}\n</visitor_question>"
