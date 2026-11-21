"""The Output Guard review: deterministic, no model, no repair loop.

`review` decides whether a Main Agent draft may be shown (`pass`), may be shown after removing
source refs that are not this turn's evidence (`repair`), or must be replaced by the fixed
insufficient-evidence response (`replace`). An answered draft that cites no valid current-turn
source is always replaced: the prompt asks for sources, but only this check enforces it. Text
is never edited: a draft with an untrusted link or e-mail address, markup, a code block or a
system-prompt line is replaced as a whole.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Final, Literal

from pydantic import BaseModel, ConfigDict, Field

from llm_agent.schemas import ContactCard, Evidence, Language

GUARD_VERSION: Final = "output-guard-4"
MAX_TEXT_CHARS: Final = 4000
LEAK_MIN_LENGTH: Final = 40

_URL = re.compile(r"(?:https?://|www\.)[^\s)\]>\"']+", re.IGNORECASE)
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_MARKUP = re.compile(r"<\s*/?\s*[a-z!][^>]*>|!\[[^\]]*\]\(|```", re.IGNORECASE)

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
        return Review("replace", (), "no_valid_source")
    finding = text_finding(draft.text, contact=contact, prompt_texts=prompt_texts)
    if finding is not None:
        return Review("replace", (), finding)
    repaired = len(refs) != len(draft.source_refs)
    return Review("repair" if repaired else "pass", refs)


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
