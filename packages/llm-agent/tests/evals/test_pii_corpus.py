"""The frozen pseudonymizer corpus and its scoring (#214): frozen, balanced and scored honestly."""

from __future__ import annotations

from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass

import pytest

from evals.pii import (
    DETECTED,
    LANGUAGES,
    RULED,
    Corpus,
    MaskedLike,
    load_corpus,
    load_floors,
    score,
)


@dataclass(frozen=True)
class _Finding:
    start: int
    end: int
    category: str


@dataclass(frozen=True)
class _Masked:
    text: str
    findings: tuple[_Finding, ...]


@pytest.fixture(scope="module")
def corpus() -> Corpus:
    return load_corpus()


def test_the_corpus_is_the_one_the_floors_were_frozen_with(corpus: Corpus) -> None:
    assert corpus.digest == load_floors().corpus_sha256


def test_the_floors_are_the_approved_initial_targets() -> None:
    floors = load_floors()
    for category in DETECTED:
        assert floors.recall[category] >= 0.9
        assert floors.precision[category] >= 0.9
    assert floors.removal == 1.0
    assert floors.public_fact_retention == 1.0


def test_each_language_has_enough_spans_of_every_category(corpus: Corpus) -> None:
    counts = Counter(
        (entry.language, span.category) for entry in corpus.entries for span in entry.spans
    )
    for language in LANGUAGES:
        assert counts[(language, "person")] >= 40
        assert counts[(language, "address")] >= 20
        for category in RULED:
            assert counts[(language, category)] >= 3, (language, category)


def test_each_language_covers_mixed_text_and_owner_facts(corpus: Corpus) -> None:
    for language in LANGUAGES:
        entries = [entry for entry in corpus.entries if entry.language == language]
        assert any(entry.mixed for entry in entries)
        assert sum(len(entry.public_facts) for entry in entries) >= 15
        # Bypass attempts: visitor PII that contains or extends an owner fact.
        assert any("Port Wren" in span.value for entry in entries for span in entry.spans)
        assert any("Marrow" in span.value for entry in entries for span in entry.spans)


def test_czech_entries_carry_diacritics_and_inflected_names(corpus: Corpus) -> None:
    czech = [
        span.value for entry in corpus.entries if entry.language == "cs" for span in entry.spans
    ]
    assert any(ch in "".join(czech) for ch in "ěščřžýáíéůú")
    assert "Tomáši Procházkovi" in czech
    assert "Karla Bláhu" in czech


def _gold_mask(corpus: Corpus) -> dict[str, _Masked]:
    masks: dict[str, _Masked] = {}
    for entry in corpus.entries:
        text = entry.text
        for span in sorted(entry.spans, key=lambda span: span.start, reverse=True):
            text = text[: span.start] + "[X]" + text[span.end :]
        findings = tuple(_Finding(span.start, span.end, span.category) for span in entry.spans)
        masks[entry.text] = _Masked(text, findings)
    return masks


def test_a_masker_that_finds_exactly_the_labels_meets_every_floor(corpus: Corpus) -> None:
    masks = _gold_mask(corpus)

    def mask(text: str, facts: Sequence[str]) -> MaskedLike:
        return masks[text]

    result = score(corpus, mask)
    assert result.failures(load_floors()) == []
    assert result.misses == []


def test_a_masker_that_masks_nothing_misses_every_floor(corpus: Corpus) -> None:
    def mask(text: str, facts: Sequence[str]) -> MaskedLike:
        return _Masked(text, ())

    failures = score(corpus, mask).failures(load_floors())
    for language in LANGUAGES:
        for category in (*DETECTED, *RULED):
            assert any(failure.startswith(f"{language} {category}") for failure in failures)


def test_a_finding_on_an_owner_fact_is_a_false_positive(corpus: Corpus) -> None:
    masks = _gold_mask(corpus)

    def mask(text: str, facts: Sequence[str]) -> MaskedLike:
        masked = masks[text]
        start = text.find("Ilsa Marrow")
        if start < 0:
            return masked
        owner = _Finding(start, start + len("Ilsa Marrow"), "person")
        hidden = masked.text.replace("Ilsa Marrow", "[X]")
        return _Masked(hidden, (*masked.findings, owner))

    result = score(corpus, mask)
    assert result.counts[("en", "person")].precision < 1.0
    assert any("public facts kept" in failure for failure in result.failures(load_floors()))
