"""The Output Guard review: deterministic, no model, no repair loop.

`review` decides whether a Main Agent draft may be shown (`pass`), may be shown after a repair
(`repair`), or must be replaced by the fixed insufficient-evidence response (`replace`). A repair
drops source refs that are not this turn's evidence from the draft's `source_refs`, and removes
every source-ref token (`src-<n>`, any case or dash) from the text that is not exactly a ref of
this turn's evidence, with its empty brackets and the space before it, in any language; valid
refs in the text are kept. A forged ref the visitor asked for (S20) is so never shown, even in a
sentence that declines it. An answered draft that cites no valid current-turn source is always
replaced: the prompt asks for sources, but only this check enforces it. Nothing else of the text
is edited: a draft with an untrusted link or e-mail address, markup, a code block or a
system-prompt line is replaced as a whole, and so is one that is empty after the repair.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Final, Literal

from pydantic import BaseModel, ConfigDict, Field

from llm_agent.schemas import ContactCard, Evidence, Language

GUARD_VERSION: Final = "output-guard-5"
MAX_TEXT_CHARS: Final = 4000
LEAK_MIN_LENGTH: Final = 40

_URL = re.compile(r"(?:https?://|www\.)[^\s)\]>\"']+", re.IGNORECASE)
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_MARKUP = re.compile(r"<\s*/?\s*[a-z!][^>]*>|!\[[^\]]*\]\(|```", re.IGNORECASE)

#: A source-ref token as a model writes it: `src-3`, `SRC-3`, `src-3a`, with any Unicode dash.
_REF_TOKEN = re.compile(r"\bsrc[\-\u2010-\u2015\u2212]\d+\w*", re.IGNORECASE)
#: Brackets left empty, or holding only separators, once the unknown refs are removed.
_EMPTY_BRACKETS = re.compile(r"\s*[(\[]\s*[,;\s]*\s*[)\]]")
_SPACE_BEFORE_PUNCTUATION = re.compile(r"[ \t]+([,.;:!?])")
_SEPARATOR_RUN = re.compile(r"([,;])(?:\s*[,;])+")
_SPACES = re.compile(r"[ \t]{2,}")

Action = Literal["pass", "repair", "replace"]
DraftOutcome = Literal["answered", "insufficient_evidence", "refused"]


class Draft(BaseModel):
    """The structured answer the Main Agent returns; nothing of it is trusted."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    outcome: DraftOutcome
    language: Language
    text: str = Field(max_length=MAX_TEXT_CHARS * 2)
    source_refs: list[str] = Field(max_length=16)
    show_contact: bool
    #: The text says that something the visitor asked about is not in the published records.
    #: Whatever the outcome, such a draft is shown with the trusted contact card.
    unpublished: bool


@dataclass(frozen=True)
class Review:
    action: Action
    #: The refs that survive, in the draft's order, without duplicates.
    refs: tuple[str, ...]
    #: The text to show: the draft's text without source refs that are not this turn's evidence.
    text: str
    #: Why the draft was replaced, for the trace.
    finding: str | None = None


def review(
    draft: Draft,
    evidence: Mapping[str, Evidence],
    *,
    contact: ContactCard | None,
    prompt_texts: Iterable[str],
) -> Review:
    refs = tuple(dict.fromkeys(ref for ref in draft.source_refs if ref in evidence))
    # An answer is shown only when it rests on at least one source of this turn's evidence.
    if draft.outcome == "answered" and not refs:
        return Review("replace", (), "", "no_valid_source")
    shown = without_unknown_refs(draft.text, evidence)
    finding = text_finding(shown, contact=contact, prompt_texts=prompt_texts)
    if finding is not None:
        return Review("replace", (), "", finding)
    repaired = len(refs) != len(draft.source_refs) or shown != draft.text
    return Review("repair" if repaired else "pass", refs, shown)


def without_unknown_refs(text: str, evidence: Mapping[str, Evidence]) -> str:
    """The text without source-ref tokens that are not exactly a ref of this turn's evidence.

    A text without such a token is returned unchanged. Otherwise the tokens are removed, then
    brackets left empty, repeated separators, the space before punctuation and doubled spaces.
    """
    removed = _REF_TOKEN.sub(lambda m: m.group(0) if m.group(0) in evidence else "", text)
    if removed == text:
        return text
    tidied = _EMPTY_BRACKETS.sub("", removed)
    tidied = _SEPARATOR_RUN.sub(r"\1", tidied)
    tidied = re.sub(r"([(\[])\s*[,;]\s*", r"\1", tidied)
    tidied = re.sub(r"\s*[,;]\s*([)\]])", r"\1", tidied)
    tidied = _SPACE_BEFORE_PUNCTUATION.sub(r"\1", tidied)
    tidied = re.sub(r"([,;])([.!?])", r"\2", tidied)
    return _SPACES.sub(" ", tidied).strip()


def text_finding(
    text: str, *, contact: ContactCard | None, prompt_texts: Iterable[str]
) -> str | None:
    """The first reason the text cannot be shown, or None."""
    if not text.strip():
        return "empty"
    if len(text) > MAX_TEXT_CHARS:
        return "too_long"
    if _MARKUP.search(text):
        return "markup"
    trusted_urls = {link.url.rstrip("/").casefold() for link in contact.links} if contact else set()
    for url in _URL.findall(text):
        if url.rstrip("/.,;:!?").rstrip("/").casefold() not in trusted_urls:
            return "untrusted_url"
    trusted_email = (contact.email or "").casefold() if contact else ""
    for email in _EMAIL.findall(text):
        if not trusted_email or email.rstrip(".").casefold() != trusted_email:
            return "untrusted_email"
    lowered = text.casefold()
    for prompt in prompt_texts:
        for line in prompt.splitlines():
            line = line.strip()
            if len(line) >= LEAK_MIN_LENGTH and line.casefold() in lowered:
                return "prompt_leak"
    return None
