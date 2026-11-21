"""The fixed English and Czech responses. No model writes them and none names a person.

The playful "Nice try ;)" refusal is kept for explicit manipulation only (injection, prompt
extraction, admin writes). Unrelated requests and provider refusals get a polite redirect. No text
claims that any action was carried out.
"""

from __future__ import annotations

from typing import Final, Literal

from llm_agent.schemas import Language

FixedText = Literal[
    "manipulation",
    "out_of_scope",
    "insufficient",
    "unavailable",
    "limit_reached",
    "cancelled",
]

TEXTS: Final[dict[FixedText, dict[Language, str]]] = {
    "manipulation": {
        "en": (
            "Nice try ;) That is not something I can do here. I am glad to answer questions about"
            " the professional profile on this website, though."
        ),
        "cs": (
            "Nice try ;) Tohle tady udělat nemůžu. Rád ale odpovím na otázky k profesnímu profilu"
            " na tomto webu."
        ),
    },
    "out_of_scope": {
        "en": (
            "I can only help with questions about the professional profile on this website, such"
            " as experience, services or how to get in touch. Is there something along those"
            " lines I can help with?"
        ),
        "cs": (
            "Pomoct umím jen s otázkami k profesnímu profilu na tomto webu, třeba ke zkušenostem,"
            " službám nebo k tomu, jak se ozvat. Můžu pomoct s něčím takovým?"
        ),
    },
    "insufficient": {
        "en": (
            "I could not confirm that from the published information. The contact details below"
            " are the best way to ask directly."
        ),
        "cs": (
            "Z publikovaných informací to potvrdit nedokážu. Nejlépe se zeptáte přímo přes"
            " kontakt níže."
        ),
    },
    "unavailable": {
        "en": "The assistant is not available right now. Please try again in a moment.",
        "cs": "Asistent teď není k dispozici. Zkuste to prosím za chvíli znovu.",
    },
    "limit_reached": {
        "en": "That question needs more than this assistant can do in one answer. Please ask"
        " something shorter or more specific.",
        "cs": "Na tuhle otázku asistent v jedné odpovědi nestačí. Zeptejte se prosím kratší nebo"
        " konkrétnější otázkou.",
    },
    "cancelled": {
        "en": "The answer was stopped.",
        "cs": "Odpověď byla zastavena.",
    },
}

#: Security categories that get the playful refusal; any other block is a polite redirect.
MANIPULATION_CATEGORIES: Final = frozenset({"injection", "prompt_extraction", "admin_write"})


def text(kind: FixedText, language: Language) -> str:
    return TEXTS[kind][language]
