"""The Output Guard review: deterministic, no model, no repair loop.

`review` decides whether a Main Agent draft may be shown (`pass`), may be shown after a repair
(`repair`), or must be replaced by the fixed insufficient-evidence response (`replace`). A repair
drops source refs that are not this turn's evidence from the draft's `source_refs`, and removes
every source-ref token from the text that is not a ref of this turn's evidence, in any language
(`without_unknown_refs`): tokens are compared after folding Unicode compatibility forms, case and
dashes, valid refs are kept in their canonical form (`src-1`), and only the site of each removal
is tidied. A forged ref the visitor asked for (S20) is so never shown, even in a sentence that
declines it; a draft in which one would remain is replaced (`unknown_ref`). An answered draft that
cites no valid current-turn source is always replaced: the prompt asks for sources, but only this
check enforces it. Nothing else of the text is edited: a draft with an untrusted link or e-mail
address, markup, a code block or a system-prompt line is replaced as a whole, and so is one that
is empty after the repair.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Container, Iterable, Mapping
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

#: How often the removal of unknown refs runs again on its own result before the draft is replaced.
_MAX_REMOVAL_PASSES: Final = 4

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
    if shown is None:
        return Review("replace", (), "", "unknown_ref")
    finding = text_finding(shown, contact=contact, prompt_texts=prompt_texts)
    if finding is not None:
        return Review("replace", (), "", finding)
    repaired = len(refs) != len(draft.source_refs) or shown != draft.text
    return Review("repair" if repaired else "pass", refs, shown)


def without_unknown_refs(text: str, known: Container[str]) -> str | None:
    """The text with every source-ref token that is not a ref in `known` removed, or None.

    A token is `src`, at most one separator (any dash, `_` or a space) and a number with any word
    characters after it, standing on its own: it does not continue a word. Tokens are compared in
    one normal form: Unicode compatibility forms (NFKC), case and dashes are folded and format
    characters such as a zero-width space are ignored. A token that is in `known` is written in
    that canonical form (`src-1`); any other is removed, and only its removal site is tidied: the
    whitespace before it, the separator joining it to a kept ref, or the brackets it leaves empty.
    The removal runs again while it leaves an unknown token (one can be built from the text around
    a removed one); if one remains after a bounded number of passes, the result is None and the
    draft is replaced. A text with no token to change is returned as the same object. Each pass is
    a single linear scan, so the time grows linearly with the text.
    """
    current = text
    for _ in range(_MAX_REMOVAL_PASSES):
        tokens = _ref_tokens(current)
        if all(t.canonical in known and t.written == t.canonical for t in tokens):
            return current
        current = _rewritten(current, tokens, known)
    tokens = _ref_tokens(current)
    if all(t.canonical in known and t.written == t.canonical for t in tokens):
        return current
    return None


@dataclass(frozen=True)
class _Token:
    start: int
    end: int
    written: str
    canonical: str


def _fold(char: str) -> str:
    return unicodedata.normalize("NFKC", char).casefold()


def _ignored(char: str) -> bool:
    """A format character (zero-width space, joiner, soft hyphen and the like)."""
    return unicodedata.category(char) == "Cf"


def _wordlike(folded: str) -> bool:
    return bool(folded) and (folded[0].isalnum() or folded[0] == "_")


def _is_separator(char: str) -> bool:
    folded = _fold(char)
    return folded in {"-", "_"} or char == "\u2212" or unicodedata.category(char) in {"Pd", "Zs"}


def _horizontal_space(char: str) -> bool:
    return char == "\t" or unicodedata.category(char) in {"Zs", "Cf"}


def _ref_tokens(text: str) -> list[_Token]:
    """Every source-ref token of the text, in order, in one linear scan."""
    tokens: list[_Token] = []
    size = len(text)
    index = 0
    after_word = False
    while index < size:
        char = text[index]
        if _ignored(char):
            index += 1
            continue
        folded = _fold(char)
        if folded == "s" and not after_word:
            token = _token_at(text, index)
            if token is not None:
                tokens.append(token)
                index = token.end
                after_word = True
                continue
        after_word = _wordlike(folded)
        index += 1
    return tokens


def _token_at(text: str, start: int) -> _Token | None:
    size = len(text)
    index = start
    for letter in "src":
        while index < size and _ignored(text[index]):
            index += 1
        if index >= size or _fold(text[index]) != letter:
            return None
        index += 1
    while index < size and _ignored(text[index]):
        index += 1
    if index < size and _is_separator(text[index]):
        index += 1
    tail: list[str] = []
    end = index
    while index < size:
        char = text[index]
        if _ignored(char):
            index += 1
            continue
        folded = _fold(char)
        if not (folded.isdecimal() if not tail else _wordlike(folded)):
            break
        tail.append(folded)
        index += 1
        end = index
    if not tail:
        return None
    return _Token(start, end, text[start:end], "src-" + "".join(tail))


_CLOSING: Final = {"(": ")", "[": "]"}


def _rewritten(text: str, tokens: list[_Token], known: Container[str]) -> str:
    """One pass: canonical kept refs, and unknown ones removed with their removal site tidied."""
    kept_ends = {t.end for t in tokens if t.canonical in known}
    kept_starts = {t.start for t in tokens if t.canonical in known}
    cuts: list[tuple[int, int, str]] = []
    run: list[_Token] = []

    def close_run() -> None:
        if run:
            cuts.append(
                (*_removal_site(text, run[0].start, run[-1].end, kept_ends, kept_starts), "")
            )
            run.clear()

    for token in tokens:
        if token.canonical in known:
            close_run()
            if token.written != token.canonical:
                cuts.append((token.start, token.end, token.canonical))
            continue
        if run and not all(
            _horizontal_space(c) or c in ",;" for c in text[run[-1].end : token.start]
        ):
            close_run()
        run.append(token)
    close_run()

    pieces: list[str] = []
    position = 0
    for start, end, replacement in cuts:
        start = max(start, position)
        pieces.append(text[position:start])
        pieces.append(replacement)
        position = max(position, end)
    pieces.append(text[position:])
    return "".join(pieces)


def _removal_site(
    text: str, start: int, end: int, kept_ends: set[int], kept_starts: set[int]
) -> tuple[int, int]:
    """The span to delete for a run of unknown refs at `text[start:end]`."""
    size = len(text)
    left = start
    while left > 0 and _horizontal_space(text[left - 1]):
        left -= 1
    right = end
    while right < size and _horizontal_space(text[right]):
        right += 1
    # Brackets that held only the removed refs go with them.
    if left > 0 and right < size and _CLOSING.get(text[left - 1]) == text[right]:
        opening, closing = left - 1, right + 1
        before = opening
        while before > 0 and _horizontal_space(text[before - 1]):
            before -= 1
        if before < opening:
            return before, closing
        after = closing
        while after < size and _horizontal_space(text[after]):
            after += 1
        return (opening, after) if opening == 0 or text[opening - 1] == "\n" else (opening, closing)
    # A ref listed after a kept one goes with its separator: "src-1, src-99" -> "src-1".
    if left > 0 and text[left - 1] in ",;":
        joined = left - 1
        while joined > 0 and _horizontal_space(text[joined - 1]):
            joined -= 1
        if joined in kept_ends:
            return joined, end
    # A ref listed before a kept one goes with its separator: "src-99, src-1" -> "src-1".
    if right < size and text[right] in ",;":
        following = right + 1
        while following < size and _horizontal_space(text[following]):
            following += 1
        if following in kept_starts:
            return start, following
    if left < start:
        # A separator left before the end of a sentence goes too: "x, src-99." -> "x.".
        if left > 0 and text[left - 1] in ",;" and (end == size or text[end] in ".!?)]"):
            return left - 1, end
        return left, end
    if start == 0 or text[start - 1] in "\n([":
        return start, right
    return start, end


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
