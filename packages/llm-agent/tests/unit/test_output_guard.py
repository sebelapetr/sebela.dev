"""The Output Guard's removal of source refs that are not this turn's evidence (#303).

`without_unknown_refs` is tested directly: it is the one place where the guard edits the text,
so its guarantees are stated here. No `src-<n>` token that is not a ref of this turn survives,
in any case, dash or Unicode compatibility form; valid refs are kept in their canonical form;
only the removal sites are tidied; and the work is linear in the length of the text.
"""

from __future__ import annotations

import time

import pytest

from llm_agent.guardrails.output import Draft, review, without_unknown_refs
from llm_agent.schemas import Evidence

KNOWN = frozenset({"src-1", "src-2"})


def evidence(*refs: str) -> dict[str, Evidence]:
    return {
        ref: Evidence(
            ref=ref,
            tool="get_profile",
            kind="person",
            record_id=f"person-{ref}",
            title="Ilsa Marrow",
            href="/",
            data={},
        )
        for ref in refs
    }


def draft(text: str) -> Draft:
    return Draft(
        outcome="answered",
        language="en",
        text=text,
        source_refs=["src-1"],
        show_contact=False,
        unpublished=False,
    )


# --- Linear time -------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "text",
    [
        # An unclosed bracket followed by a long run of whitespace (cubic in the old tidy).
        "I cannot cite src-99 (" + " " * 8000 + "sorry",
        "I cannot cite src-99 (" + "\n" * 8000 + "sorry",
        "I cannot cite src-99 [" + " ,; " * 2000 + "sorry",
        # A long run of whitespace before ordinary text (quadratic from a leading `\s*`).
        "Ilsa" + " " * 8000 + "wrote it, src-99.",
        "src-99" + " \t" * 4000 + "x",
        # Many removal sites and many near-tokens.
        "src-98 " * 1100,
        "src-(" * 1600,
        "s" + "​" * 8000 + "rc-99",
    ],
)
def test_the_removal_is_linear_in_the_text(text: str) -> None:
    started = time.perf_counter()
    without_unknown_refs(text, KNOWN)
    review(draft(text[:8000]), evidence("src-1"), contact=None, prompt_texts=())
    assert time.perf_counter() - started < 0.1


# --- No forged ref is reassembled --------------------------------------------------------------


@pytest.mark.parametrize(
    ("written", "shown"),
    [
        ("I cannot cite src-(src-98)99.", "I cannot cite."),
        ("Source src-[]99, src-98.", "Source src-[]99."),
        ("src-[ ; ]99 (src-98)", "src-[ ; ]99"),
        ("Ilsa (src-1) src-(src-98)99 wrote it.", "Ilsa (src-1) wrote it."),
    ],
)
def test_a_removal_never_reassembles_an_unknown_ref(written: str, shown: str) -> None:
    assert without_unknown_refs(written, KNOWN) == shown


def test_a_ref_still_unknown_after_the_bounded_passes_replaces_the_draft() -> None:
    nested = "src-(" * 12 + "src-90" + ")9" * 12
    assert without_unknown_refs(nested, KNOWN) is None
    verdict = review(draft(f"Ilsa wrote it {nested}."), evidence("src-1"), contact=None, prompt_texts=())
    assert verdict.action == "replace"
    assert verdict.finding == "unknown_ref"


@pytest.mark.parametrize(
    "written",
    [
        "I cannot cite src-(src-98)99.",
        "Source src-[]99, src-98.",
        "src-[ ; ]99 (src-98)",
        "src-(src-(src-97)98)99 is not a record.",
    ],
)
def test_no_unknown_ref_survives_a_review(written: str) -> None:
    verdict = review(draft(written), evidence("src-1"), contact=None, prompt_texts=())
    for forged in ("src-97", "src-98", "src-99"):
        assert forged not in verdict.text


# --- Only the removal sites are tidied ---------------------------------------------------------


@pytest.mark.parametrize(
    ("written", "shown"),
    [
        ("Call foo() then src-99", "Call foo() then"),
        ("Poměr 3 : 1 a src-99.", "Poměr 3 : 1 a."),
        ("Paragraph one.\n\n(src-99) Paragraph two.", "Paragraph one.\n\nParagraph two."),
        ("Paragraph one.\n\nsrc-99 Paragraph two.", "Paragraph one.\n\nParagraph two."),
        ("A list ( , ) stays; src-99 goes.", "A list ( , ) stays; goes."),
        ("Two  spaces stay, src-99 goes.", "Two  spaces stay, goes."),
        ("Sources src-1, src-99.", "Sources src-1."),
        ("Sources src-99, src-1.", "Sources src-1."),
        ("Sources (src-1; src-98, src-99).", "Sources (src-1)."),
        ("Fact [src-98] and (src-99) more.", "Fact and more."),
        ("Fact (src-98) (src-99).", "Fact."),
        ("Zdroj src-99 nemohu uvést.", "Zdroj nemohu uvést."),
        ("Odkaz ani zdroj src-99, který jste uvedl.", "Odkaz ani zdroj, který jste uvedl."),
    ],
)
def test_only_the_removal_sites_are_tidied(written: str, shown: str) -> None:
    assert without_unknown_refs(written, KNOWN) == shown


def test_a_text_without_an_unknown_ref_is_returned_unchanged() -> None:
    text = "Call foo() then (src-1) ; ratio 3 : 1.\n\nNext paragraph."
    assert without_unknown_refs(text, KNOWN) is text


# --- One rule for case, dashes and Unicode forms -----------------------------------------------


@pytest.mark.parametrize(
    ("written", "shown"),
    [
        ("Ilsa wrote it (SRC-1).", "Ilsa wrote it (src-1)."),
        ("Ilsa wrote it (src–1).", "Ilsa wrote it (src-1)."),
        ("Ilsa wrote it (src‑1, Src−2).", "Ilsa wrote it (src-1, src-2)."),
        ("Ilsa wrote it (ｓｒｃ－１).", "Ilsa wrote it (src-1)."),
        ("Ilsa wrote it (src-​1).", "Ilsa wrote it (src-1)."),
    ],
)
def test_a_valid_ref_in_any_case_or_dash_is_kept_in_its_canonical_form(
    written: str, shown: str
) -> None:
    assert without_unknown_refs(written, KNOWN) == shown


@pytest.mark.parametrize(
    "forged",
    [
        "src-99",
        "SRC-99",
        "src–99",
        "src﹣99",
        "src－99",
        "ｓｒｃ-99",
        "src​-99",
        "s​rc-99",
        "src 99",
        "src_99",
        "src99",
        "src-99a",
        "src-10",
    ],
)
def test_an_unknown_ref_in_any_variant_is_removed(forged: str) -> None:
    assert without_unknown_refs(f"Ilsa wrote it {forged}.", KNOWN) == "Ilsa wrote it."


@pytest.mark.parametrize(
    "text",
    [
        "Use srcset for images.",
        "The code lives in src/app and src-folder.",
        "The resources (src) are listed.",
        "A subsrc-99 is part of a word.",
        "src-x is no ref.",
    ],
)
def test_ordinary_words_are_not_refs(text: str) -> None:
    assert without_unknown_refs(text, KNOWN) is text
