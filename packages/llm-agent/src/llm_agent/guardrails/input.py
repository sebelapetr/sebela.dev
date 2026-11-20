"""Deterministic handling of visitor input before any model sees it.

The question is wrapped as delimited visitor data; delimiter look-alikes inside it (with or without
attributes) are neutralized so the visitor cannot close the block. The language of the turn is
chosen without a model: an explicit EN/CS switch, else the question's own language, else the
language of the newest earlier exchange, else English.
"""

from __future__ import annotations

import re
import unicodedata
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
#: Language switches are matched on lower-case text without diacritics, so "Muzes odpovidat
#: anglicky?" counts like "Můžeš odpovídat anglicky?". A clause is a switch only when all of it is
#: a request for a language: optional polite words, an optional answering verb with its objects,
#: the language, and optional polite words after it. A clause that also asks or says something
#: else ("Which project did you write in Czech?", "Is the CV available in Czech?") is no switch.
_CLAUSE = re.compile(r"[.!?;:\n]+|\b(?:and|but|ale)\b")
_EN_POLITE = (
    r"please|pls|kindly|now|so|ok|okay|also|then|no|wait|actually|sorry|hey|thanks|thank you"
    r"|from now on|from here on|going forward|again|instead|only|just|too|if possible"
    r"|if you can|for me|can you|could you|would you|will you|would you mind|i'd like you to"
    r"|i would like you to|i want you to|i'd prefer|i would prefer|let's|lets|let us|you can"
)
_EN_VERB = (
    r"(?:answer|reply|respond|write|continue|speak|talk|switch|explain|say|translate|repeat)"
    r"(?:ing)?|tell me|tell us|give me|go on|keep going"
)
_EN_OBJECT = (
    r"me|to me|us|it|that|this|everything|more|a bit|a little|a bit more|some more|the rest"
    r"|the answer|your answer|answers|back"
    r"|again|please|only|just|from now on|about it|about that|about her|about him"
)
_EN_REQUEST = re.compile(
    rf"(?P<before>(?:(?:{_EN_POLITE})\s+)*)"
    rf"(?P<verb>(?:{_EN_VERB})(?:\s+(?:{_EN_OBJECT}))*\s+)?"
    r"(?P<prep>(?:in|to|into)\s+)?(?P<lang>english|czech)(?:\s+language)?"
    rf"(?P<after>(?:\s+(?:{_EN_POLITE}))*)"
)
_CS_POLITE = (
    r"prosim|prosimte|prosim vas|diky|dik|dekuji|dekuju|ted|uz|od ted|odted|nadale|dal|jen"
    r"|jenom|pouze|radsi|radeji|tak|no|ok|dobre|vlastne|zase|znovu|i|taky|take|klidne|pak|a"
    r"|hned|muzes|muzete|mohl bys|mohla bys|mohl byste|mohla byste|mohli byste|budes|budete"
    r"|zkus|zkuste|chci|chtel bych|chtela bych|potreboval bych|potrebovala bych|jestli muzes"
    r"|jestli muzete|at|slo by|mi|nam|to|ji|vic|vice|vse|vsechno|zbytek|odpoved|odpovedi"
)
_CS_VERB = (
    r"odpovidej|odpovidejte|odpovez|odpovezte|odpovidat|odpovedet|pis|piste|napis|napiste"
    r"|psat|napsat|mluv|mluvte|mluvit|pokracuj|pokracujte|pokracovat|prepni|prepnete|prepnout"
    r"|rekni|reknete|rict|rikat|povez|povezte|vysvetli|vysvetlete|vysvetlit|povidej|povidejte|preloz|prelozte"
    r"|prelozit|komunikuj|komunikujte|komunikovat|zopakuj|zopakujte|zopakovat"
)
_CS_REQUEST = re.compile(
    rf"(?P<before>(?:(?:{_CS_POLITE})\s+)*)"
    rf"(?P<verb>(?:{_CS_VERB})(?:\s+(?:{_CS_POLITE}))*\s+)?"
    r"(?P<prep>(?:v|po|na|do)\s+)?"
    r"(?P<lang>anglick[yu]|anglictin[eouya]|anglictinou|cesk[yu]|cestin[eouya]|cestinou)"
    rf"(?P<after>(?:\s+(?:{_CS_POLITE}))*)"
)


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


def _switch(question: str) -> Language | None:
    plain = "".join(
        char
        for char in unicodedata.normalize("NFKD", question.casefold().replace("\u2019", "'"))
        if not unicodedata.combining(char)
    )
    found: Language | None = None
    for clause in _CLAUSE.split(plain):
        words = " ".join(re.findall(r"[\w']+", clause))
        for request in (_EN_REQUEST, _CS_REQUEST):
            match = request.fullmatch(words)
            if match is None:
                continue
            # A bare language word ("Czech?") is a question, not a request: it needs a verb, a
            # preposition or a polite word.
            if match["verb"] or match["prep"] or match["before"] or match["after"]:
                found = "en" if match["lang"].startswith(("english", "angl")) else "cs"
    return found


def neutralized(text: str) -> str:
    """Visitor text in which no delimiter look-alike survives."""
    return _DELIMITER.sub("[removed delimiter]", text)


def visitor_block(question: str) -> str:
    """The question as untrusted, delimited visitor data."""
    return f"<visitor_question>\n{neutralized(question)}\n</visitor_question>"
