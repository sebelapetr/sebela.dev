"""Deterministic handling of visitor input before any model sees it.

The question is wrapped as delimited visitor data; delimiter look-alikes inside it (with or without
attributes) are neutralized so the visitor cannot close the block. The language of the turn is
chosen without a model: an explicit EN/CS switch, else the question's own language, else the
language of the newest earlier exchange, else English.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Mapping, Sequence
from types import MappingProxyType
from typing import Literal

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

# --- Language switches ---------------------------------------------------------------------------
#
# Switches are matched on lower-case words without diacritics, so "Muzes odpovidat anglicky?"
# counts like "Můžeš odpovídat anglicky?". The question is split into clauses at sentence
# punctuation, commas, "and", "but" and "ale"; a clause of polite words only ("please", "díky")
# joins the clause it is comma-separated from. A clause is a switch only when it matches one of the
# request shapes below as a whole. Matching walks the clause's words once per shape, tracking the
# set of reachable positions, so its time grows linearly with the question and never backtracks.

Phrase = tuple[str, ...]
#: Phrases by their first word, so a position tries only the phrases that can start there.
_Phrases = Mapping[str, tuple[Phrase, ...]]
#: One word that is no negation: the free content of an imperative ("Tell me about … in Czech").
_ANY: _Phrases = MappingProxyType({})
_Repeat = Literal["one", "optional", "many"]
_Shape = tuple[tuple[_Phrases, _Repeat], ...]
#: Which language word of a matched clause is the requested one.
_Pick = Literal["first", "last"]


def _phrases(*groups: str) -> _Phrases:
    index: dict[str, list[Phrase]] = {}
    for group in groups:
        for phrase in group.split("|"):
            words = tuple(phrase.split())
            index.setdefault(words[0], []).append(words)
    return {first: tuple(found) for first, found in index.items()}


_NEGATIONS = frozenset(
    {"not", "no", "never", "don't", "dont", "without", "nor", "ne", "nikdy", "bez"}
)

# English. Request words make a bare language word a request ("Czech please", "English only");
# fillers do not ("Also Czech?", "Czech too?"). After a question form ("can you", "could you") only
# the short objects below count, so "Can you write code in Czech?" stays a question. "No" alone is
# no polite word: "No Czech, please." refuses Czech.
_EN_REQUESTING = (
    "please|pls|kindly|now|from now on|from here on|going forward|instead|only|just|if possible"
    "|if you can|for me|i'd like you to|i would like you to|i want you to|i'd prefer"
    "|i would prefer|let's|lets|let us"
)
_EN_QUESTION_FORM = "can you|could you|would you|will you|would you mind|you can"
_EN_FILLER = "so|ok|okay|also|then|no wait|wait|actually|sorry|hey|thanks|thank you|again|too"
_EN_IMPERATIVE = (
    "answer|reply|respond|write|continue|speak|talk|switch|explain|describe|say|translate|repeat"
    "|tell me|tell us|give me|go on|keep going"
)
_EN_TELLING = "tell me|tell us|explain|describe|say"
_EN_GERUND = "answering|replying|responding|writing|continuing|speaking|talking|explaining"
_EN_OBJECT = (
    "me|to me|us|it|that|this|everything|more|a bit|a little|a bit more|some more|the rest"
    "|the answer|your answer|answers|back|again|please|only|just|from now on|about it|about that"
    "|about her|about him"
)
_EN_LANG = "english|czech"
_EN_PREP = "in|to|into"
_EN_TARGET = "in english|in czech|into english|into czech|to english|to czech"

# Czech. The same split; "a", "taky" and "tak" are fillers ("A česky?" asks), "prosím", "teď" and
# "jen" request. The free content of an imperative ends in an unambiguous target ("anglicky",
# "v angličtině", "do češtiny"), so "Přelož to z češtiny" is no switch.
_CS_REQUESTING = (
    "prosim|prosimte|prosim vas|ted|uz|od ted|odted|nadale|dal|jen|jenom|pouze|radsi|radeji"
    "|hned|zkus|zkuste|chci|chtel bych|chtela bych|potreboval bych|potrebovala bych|at"
)
_CS_QUESTION_FORM = (
    "muzes|muzete|mohl bys|mohla bys|mohl byste|mohla byste|mohli byste|budes|budete"
    "|jestli muzes|jestli muzete|slo by"
)
_CS_FILLER = (
    "diky|dik|dekuji|dekuju|tak|no|ok|dobre|vlastne|zase|znovu|i|taky|take|klidne|pak|a|mi|nam"
    "|to|ji|vic|vice|vse|vsechno|zbytek|odpoved|odpovedi"
)
_CS_IMPERATIVE = (
    "odpovidej|odpovidejte|odpovez|odpovezte|pis|piste|napis|napiste|mluv|mluvte|pokracuj"
    "|pokracujte|prepni|prepnete|rekni|reknete|povez|povezte|vysvetli|vysvetlete|popis|popiste"
    "|povidej|povidejte|preloz|prelozte|komunikuj|komunikujte|zopakuj|zopakujte"
)
_CS_TELLING = "rekni|reknete|povez|povezte|vysvetli|vysvetlete|popis|popiste|napis|napiste"
_CS_INFINITIVE = (
    "odpovidat|odpovedet|psat|napsat|mluvit|pokracovat|prepnout|rict|rikat|vysvetlit|popsat"
    "|prelozit|komunikovat|zopakovat"
)
_CS_LANG = (
    "|".join(stem + ending for stem in ("anglick", "cesk") for ending in ("y", "u"))
    + "|"
    + "|".join(
        stem + ending
        for stem in ("anglictin", "cestin")
        for ending in ("e", "o", "u", "y", "a", "ou")
    )
)
_CS_PREP = "v|po|na|do"
_CS_TARGET = (
    "anglicky|cesky|anglictinou|cestinou|v anglictine|v cestine|po anglicku|po cesku"
    "|do anglictiny|do cestiny|na anglictinu|na cestinu"
)


def _shapes(
    *,
    requesting: str,
    question_form: str,
    filler: str,
    imperative: str,
    telling: str,
    verb: str,
    objects: str,
    lang: str,
    prep: str,
    target: str,
    language_word: str,
) -> tuple[tuple[_Shape, _Pick], ...]:
    polite = _phrases(requesting, question_form, filler)
    plain_polite = _phrases(requesting, filler)
    lang_set = _phrases(lang)
    suffix: _Shape = ((_phrases(language_word), "optional"), (polite, "many"))
    shapes: tuple[_Shape, ...] = (
        # "Please tell me about her projects in Czech", "Řekni mi o jejích projektech anglicky"
        (
            (plain_polite, "many"),
            (_phrases(imperative), "one"),
            (_ANY, "many"),
            (_phrases(target), "one"),
            *suffix,
        ),
        # "Could you answer in Czech from now on", "Mohl bys mi to napsat anglicky"
        (
            (polite, "many"),
            (_phrases(imperative, verb), "one"),
            (_phrases(objects), "many"),
            (_phrases(prep), "optional"),
            (lang_set, "one"),
            *suffix,
        ),
        # "Ok, now in Czech", "Radši v angličtině"
        ((polite, "many"), (_phrases(prep), "one"), (lang_set, "one"), *suffix),
        # "Please, Czech", "Prosím česky"
        (
            (polite, "many"),
            (_phrases(requesting), "one"),
            (polite, "many"),
            (lang_set, "one"),
            *suffix,
        ),
        # "Czech only, please", "Česky prosím"
        (
            (polite, "many"),
            (lang_set, "one"),
            (_phrases(language_word), "optional"),
            (polite, "many"),
            (_phrases(requesting), "one"),
            (polite, "many"),
        ),
    )
    # "Tell me in Czech what she built", "Řekni mi anglicky, co postavila": a telling verb whose
    # target comes first, so the requested language is the first language word, not the last.
    leading: _Shape = (
        (plain_polite, "many"),
        (_phrases(telling), "one"),
        (_phrases(objects), "many"),
        (_phrases(target), "one"),
        (_phrases(language_word), "optional"),
        (_ANY, "many"),
    )
    return (*((shape, "last") for shape in shapes), (leading, "first"))


def _exclaimed(lang: str, language_word: str, *polite: str) -> _Shape:
    """A bare language word that is exclaimed or introduces the rest ("English!", "Anglicky: …")."""
    words = _phrases(*polite)
    return (
        (words, "many"),
        (_phrases(lang), "one"),
        (_phrases(language_word), "optional"),
        (words, "many"),
    )


_EN_SHAPES = _shapes(
    requesting=_EN_REQUESTING,
    question_form=_EN_QUESTION_FORM,
    filler=_EN_FILLER,
    imperative=_EN_IMPERATIVE,
    telling=_EN_TELLING,
    verb=_EN_GERUND,
    objects=_EN_OBJECT,
    lang=_EN_LANG,
    prep=_EN_PREP,
    target=_EN_TARGET,
    language_word="language",
)
_CS_SHAPES = _shapes(
    requesting=_CS_REQUESTING,
    question_form=_CS_QUESTION_FORM,
    filler=_CS_FILLER,
    imperative=_CS_IMPERATIVE,
    telling=_CS_TELLING,
    verb=_CS_INFINITIVE,
    objects=_CS_REQUESTING + "|" + _CS_QUESTION_FORM + "|" + _CS_FILLER,
    lang=_CS_LANG,
    prep=_CS_PREP,
    target=_CS_TARGET,
    language_word="jazyk|jazyce",
)
_EXCLAIMED: tuple[tuple[_Shape, _Pick], ...] = (
    (_exclaimed(_EN_LANG, "language", _EN_REQUESTING, _EN_FILLER), "last"),
    (_exclaimed(_CS_LANG, "jazyk|jazyce", _CS_REQUESTING, _CS_FILLER), "last"),
)
#: Shapes that end in the language come first; in them only polite words follow it.
_SHAPES = tuple(sorted(_EN_SHAPES + _CS_SHAPES, key=lambda entry: entry[1] == "first"))
_EXCLAIMED_SHAPES = _EXCLAIMED + _SHAPES
_POLITE_ONLY: _Shape = (
    (
        _phrases(
            _EN_REQUESTING,
            _EN_QUESTION_FORM,
            _EN_FILLER,
            _CS_REQUESTING,
            _CS_QUESTION_FORM,
            _CS_FILLER,
        ),
        "many",
    ),
)
_ENGLISH_TARGETS = frozenset(
    word for word in ("english", *_CS_LANG.split("|")) if word.startswith(("english", "anglic"))
)
_LANGUAGE_WORDS = frozenset(_EN_LANG.split("|")) | frozenset(_CS_LANG.split("|"))
_TOKEN = re.compile(r"\w+(?:'\w+)*|[.!?;:,\n]")
_PUNCTUATION = frozenset(".!?;:,\n")
_CONJUNCTIONS = frozenset({"and", "but", "ale"})


def _ends(words: Phrase, start: int, phrases: _Phrases) -> list[int]:
    """The positions one phrase of `phrases` can end at when it starts at `start`."""
    if start >= len(words):
        return []
    if phrases is _ANY:
        return [] if words[start] in _NEGATIONS else [start + 1]
    return [
        start + len(phrase)
        for phrase in phrases.get(words[start], ())
        if words[start : start + len(phrase)] == phrase
    ]


def _matches(words: Phrase, shape: _Shape) -> bool:
    """Whether the whole clause has this shape; each position is visited once per element."""
    reachable = {0}
    for phrases, repeat in shape:
        after: set[int] = set(reachable) if repeat != "one" else set()
        frontier = list(reachable)
        while frontier:
            start = frontier.pop()
            for end in _ends(words, start, phrases):
                if end in after:
                    continue
                after.add(end)
                if repeat == "many":
                    frontier.append(end)
        if not after:
            return False
        reachable = after
    return len(words) in reachable


def _clauses(plain: str) -> list[tuple[Phrase, str]]:
    """The clauses of the question with the punctuation that ends each ("" when none does)."""
    split: list[tuple[Phrase, str]] = []
    words: list[str] = []
    for token in _TOKEN.findall(plain):
        if token in _CONJUNCTIONS or token in _PUNCTUATION:
            if words:
                split.append((tuple(words), "" if token in _CONJUNCTIONS else token))
            words = []
        else:
            words.append(token)
    if words:
        split.append((tuple(words), ""))
    joined: list[tuple[Phrase, str]] = []
    pending: Phrase = ()
    for clause, end in split:
        polite_only = _matches(clause, _POLITE_ONLY)
        if polite_only and joined and joined[-1][1] == ",":
            joined[-1] = (joined[-1][0] + clause, end)
        elif polite_only and end == ",":
            pending += clause
        else:
            joined.append((pending + clause, end))
            pending = ()
    if pending:
        joined.append((pending, ""))
    return joined


def _switch(question: str) -> Language | None:
    plain = "".join(
        char
        for char in unicodedata.normalize("NFKD", question.casefold().replace("\u2019", "'"))
        if not unicodedata.combining(char)
    )
    found: Language | None = None
    for words, end in _clauses(plain):
        shapes = _EXCLAIMED_SHAPES if end in {"!", ":"} else _SHAPES
        pick = next((pick for shape, pick in shapes if _matches(words, shape)), None)
        if pick is not None:
            ordered = reversed(words) if pick == "last" else iter(words)
            lang = next(word for word in ordered if word in _LANGUAGE_WORDS)
            found = "en" if lang in _ENGLISH_TARGETS else "cs"
    return found


def select_language(question: str, history: Sequence[ChatExchange] = ()) -> Language:
    """The language of this turn.

    An explicit switch in the question wins (the last one when there are several). Otherwise a
    question that is recognisably Czech or English sets the language, and an ambiguous short
    follow-up ("Brindle Labs?") inherits the newest earlier exchange's language, initially English.
    """
    switch = _switch(question)
    if switch is not None:
        return switch
    detected = _detected(question)
    if detected is not None:
        return detected
    return history[-1].language if history else "en"


def _detected(question: str) -> Language | None:
    """The question's own language, or None when it is too short or mixed to tell.

    Common words decide before letters, so a Czech name ("What did she do at Škoda?") does not make
    an English question Czech, while a short question with Czech letters ("Řekni víc") is Czech.
    """
    words = [word.casefold() for word in _WORD.findall(question)]
    czech = sum(word in _CZECH_WORDS for word in words) + (words[:2] == ["a", "co"])
    english = sum(word in _ENGLISH_WORDS for word in words)
    if czech >= 2 and czech > english:
        return "cs"
    if english >= 2:
        return "en"
    if _CZECH_LETTERS.search(question) or czech >= 2:
        return "cs"
    return None


def neutralized(text: str) -> str:
    """Visitor text in which no delimiter look-alike survives."""
    return _DELIMITER.sub("[removed delimiter]", text)


def visitor_block(question: str) -> str:
    """The question as untrusted, delimited visitor data."""
    return f"<visitor_question>\n{neutralized(question)}\n</visitor_question>"
