"""The frozen local corpus of the trace pseudonymizer and its scoring (#214), free to run.

`corpus.json` holds fictional EN/CS texts with labelled spans written `[[category:value]]`;
`floors.json` holds the acceptance floors and the corpus digest they were frozen with. Both were
written before the first implementation and before any detector candidate was compared: a
candidate is measured against them, never the other way round (`.plan/07-ai-service/evals.md`,
Local detector selection and measurements).

Scoring, per language and per category, never one anonymity percentage:

- person and address (the detector's categories): a labelled span is *found* when every letter or
  digit of it lies inside a finding of the same category (recall); a finding is *correct* when it
  overlaps a labelled span of the same category (precision). A finding on an owner fact is a false
  positive like any other.
- email, phone, secret and fixed_id (the rules' categories): a labelled value is *removed* when it
  no longer occurs in the masked text. Every one must be removed.
- public facts: every fact an entry lists must still occur in the masked text.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal, Protocol

Language = Literal["en", "cs"]
LANGUAGES: tuple[Language, ...] = ("en", "cs")
DETECTED = ("person", "address")
RULED = ("email", "phone", "secret", "fixed_id")
CATEGORIES = DETECTED + RULED

_HERE = Path(__file__).parent
CORPUS_PATH = _HERE / "corpus.json"
FLOORS_PATH = _HERE / "floors.json"
_SPAN = re.compile(r"\[\[([a-z_]+):(.+?)\]\]")


@dataclass(frozen=True)
class Gold:
    start: int
    end: int
    category: str
    value: str


@dataclass(frozen=True)
class Entry:
    id: str
    language: Language
    text: str
    spans: tuple[Gold, ...]
    public_facts: tuple[str, ...]
    mixed: bool = False


@dataclass(frozen=True)
class Corpus:
    version: str
    digest: str
    owner_facts: tuple[str, ...]
    entries: tuple[Entry, ...]


class FindingLike(Protocol):
    @property
    def start(self) -> int: ...
    @property
    def end(self) -> int: ...
    @property
    def category(self) -> str: ...


class MaskedLike(Protocol):
    @property
    def text(self) -> str: ...
    @property
    def findings(self) -> Sequence[FindingLike]: ...


#: Masks one text given the owner's public facts; findings are in the original text's offsets.
Mask = Callable[[str, Sequence[str]], MaskedLike]


def _parse(raw: str) -> tuple[str, tuple[Gold, ...]]:
    text: list[str] = []
    spans: list[Gold] = []
    position = 0
    length = 0
    for match in _SPAN.finditer(raw):
        before = raw[position : match.start()]
        text.append(before)
        length += len(before)
        category, value = match.group(1), match.group(2)
        if category not in CATEGORIES:
            raise ValueError(f"unknown category {category!r}")
        spans.append(Gold(length, length + len(value), category, value))
        text.append(value)
        length += len(value)
        position = match.end()
    text.append(raw[position:])
    plain = "".join(text)
    if "[[" in plain or "]]" in plain:
        raise ValueError(f"unbalanced span markup in {raw!r}")
    return plain, tuple(spans)


def load_corpus(path: Path = CORPUS_PATH) -> Corpus:
    data = path.read_bytes()
    document = json.loads(data)
    entries: list[Entry] = []
    for item in document["entries"]:
        text, spans = _parse(item["text"])
        facts = tuple(item["public_facts"])
        for fact in facts:
            if fact not in text:
                raise ValueError(f"{item['id']}: public fact {fact!r} is not in the text")
        entries.append(
            Entry(item["id"], item["language"], text, spans, facts, bool(item.get("mixed")))
        )
    return Corpus(
        document["version"],
        hashlib.sha256(data).hexdigest(),
        tuple(document["owner_facts"]),
        tuple(entries),
    )


@dataclass(frozen=True)
class Floors:
    corpus_sha256: str
    recall: dict[str, float]
    precision: dict[str, float]
    removal: float
    public_fact_retention: float


def load_floors(path: Path = FLOORS_PATH) -> Floors:
    document = json.loads(path.read_text(encoding="utf-8"))
    return Floors(
        document["corpus_sha256"],
        {category: document["detected"][category]["recall"] for category in DETECTED},
        {category: document["detected"][category]["precision"] for category in DETECTED},
        document["removal"],
        document["public_fact_retention"],
    )


@dataclass
class Counts:
    gold: int = 0
    found: int = 0
    predicted: int = 0
    correct: int = 0

    @property
    def recall(self) -> float:
        return self.found / self.gold if self.gold else 1.0

    @property
    def precision(self) -> float:
        return self.correct / self.predicted if self.predicted else 1.0


@dataclass
class Score:
    #: (language, category) -> counts; for rule categories `found` counts removed values.
    counts: dict[tuple[str, str], Counts] = field(default_factory=dict)
    #: language -> (facts kept, facts listed)
    facts: dict[str, tuple[int, int]] = field(default_factory=dict)
    misses: list[str] = field(default_factory=list)

    def failures(self, floors: Floors) -> list[str]:
        problems: list[str] = []
        for (language, category), counts in sorted(self.counts.items()):
            if category in DETECTED:
                if counts.recall < floors.recall[category]:
                    problems.append(
                        f"{language} {category} recall {counts.recall:.3f}"
                        f" < {floors.recall[category]}"
                    )
                if counts.precision < floors.precision[category]:
                    problems.append(
                        f"{language} {category} precision {counts.precision:.3f}"
                        f" < {floors.precision[category]}"
                    )
            elif counts.recall < floors.removal:
                problems.append(f"{language} {category} removal {counts.recall:.3f} < 1.0")
        for language, (kept, listed) in sorted(self.facts.items()):
            if listed and kept / listed < floors.public_fact_retention:
                problems.append(f"{language} public facts kept {kept}/{listed}")
        return problems


def _letters(text: str, start: int, end: int) -> set[int]:
    return {index for index in range(start, end) if text[index].isalnum()}


def score(corpus: Corpus, mask: Mask) -> Score:
    result = Score()
    for entry in corpus.entries:
        masked = mask(entry.text, corpus.owner_facts)
        for category in CATEGORIES:
            counts = result.counts.setdefault((entry.language, category), Counts())
            gold = [span for span in entry.spans if span.category == category]
            counts.gold += len(gold)
            if category in RULED:
                for span in gold:
                    if span.value in masked.text:
                        result.misses.append(f"{entry.id}: {category} kept")
                    else:
                        counts.found += 1
                continue
            findings = [finding for finding in masked.findings if finding.category == category]
            covered: set[int] = set()
            for finding in findings:
                covered |= set(range(finding.start, finding.end))
            for span in gold:
                if _letters(entry.text, span.start, span.end) <= covered:
                    counts.found += 1
                else:
                    result.misses.append(f"{entry.id}: {category} missed")
            counts.predicted += len(findings)
            for finding in findings:
                if any(finding.start < span.end and span.start < finding.end for span in gold):
                    counts.correct += 1
                else:
                    result.misses.append(f"{entry.id}: {category} false positive")
        kept, listed = result.facts.get(entry.language, (0, 0))
        present = sum(1 for fact in entry.public_facts if fact in masked.text)
        if present < len(entry.public_facts):
            result.misses.append(f"{entry.id}: a public fact was masked")
        result.facts[entry.language] = (kept + present, listed + len(entry.public_facts))
    return result


def report(result: Score) -> str:
    lines = ["language category  gold  found  recall  predicted  correct  precision"]
    for (language, category), counts in sorted(result.counts.items()):
        precision = f"{counts.precision:.3f}" if category in DETECTED else "-"
        predicted = str(counts.predicted) if category in DETECTED else "-"
        correct = str(counts.correct) if category in DETECTED else "-"
        lines.append(
            f"{language:<8} {category:<9} {counts.gold:>5} {counts.found:>6} "
            f"{counts.recall:>7.3f} {predicted:>10} {correct:>8} {precision:>10}"
        )
    for language, (kept, listed) in sorted(result.facts.items()):
        lines.append(f"{language} public facts kept: {kept}/{listed}")
    return "\n".join(lines)
