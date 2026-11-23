"""The Output Guard's link and address check (#395).

A draft that names a host outside the trusted contact links is replaced, whatever form the link
takes: with an `http`/`https` scheme or `www.`, as a bare host name, protocol-relative (`//host`),
with another scheme, as the target of a markdown link, or disguised (other dots, invisible
characters, brackets, escapes, entities, case). Trusted contact links and the site's own record
links pass with and without a scheme; ordinary text with dots (file names, versions,
abbreviations) is not a link.
"""

from __future__ import annotations

import time

import pytest

from llm_agent.guardrails.output import GUARD_VERSION, Draft, review
from llm_agent.schemas import ContactCard, ContactLink, Evidence

CONTACT = ContactCard(
    name="Ilsa Marrow",
    email="ilsa@marrow.example.test",
    links=[
        ContactLink(label="Website", url="https://marrow.example.test/"),
        ContactLink(label="Code", url="https://code.example.test/ilsa-marrow"),
    ],
)


def evidence() -> dict[str, Evidence]:
    return {
        "src-1": Evidence(
            ref="src-1",
            tool="get_profile",
            kind="profile",
            record_id="profile-1",
            title="Ilsa Marrow",
            href="/",
            data={},
        )
    }


def finding(text: str, contact: ContactCard | None = CONTACT) -> str | None:
    draft = Draft(
        outcome="answered",
        language="en",
        text=text,
        source_refs=["src-1"],
        show_contact=False,
        unpublished=False,
    )
    return review(draft, evidence(), contact=contact, prompt_texts=()).finding


def test_the_guard_version_names_the_link_check() -> None:
    assert GUARD_VERSION == "output-guard-6"


# --- Untrusted links in every form are replaced --------------------------------------------------


@pytest.mark.parametrize(
    "text",
    [
        # A bare host name, with and without a path, port or trailing punctuation.
        "See evil.example.test for details.",
        "See evil.example.test/offer for details.",
        "Her new site is evil.com.",
        "Book a call at attacker.io/ilsa (it is quick).",
        "Proof: proof.example.test/ilsa-google",
        "Try evil.example.test:8080 now.",
        "The talk is on events.example.org.",
        # `www.` and an http(s) scheme, as before.
        "See www.evil.example.test.",
        "See www.evil for details.",
        "See https://evil.example.test/offer for details.",
        "See HTTP://EVIL.EXAMPLE.TEST/offer.",
        # Protocol-relative.
        "See //evil.example.test/x for details.",
        "See \\\\evil.example.test\\x for details.",
        # Other schemes and scheme spellings a browser still follows.
        "Open ftp://evil.example.test/file now.",
        "Open hxxp://evil.example.test/file now.",
        "Open s3://evil-bucket/file now.",
        "Click javascript:alert(document.cookie) for more.",
        "Open data:text/html;base64,PHNjcmlwdD4= for more.",
        "Call tel:+10000000000 today.",
        "Write to mailto:x@evil.example.test today.",
        "See https:evil.example.test for details.",
        "See https:/evil.example.test for details.",
        "See https:\\\\evil.example.test for details.",
        # A markdown link whose target is a bare host, protocol-relative or a scheme.
        "Read [her paper](evil.example.test/paper).",
        "Read [her paper](//evil.example.test/paper).",
        "Read [her paper](https://evil.example.test/paper).",
        "Read [her site](marrow.example.test.evil.com).",
        # Disguised host names.
        "See evil\uff0eexample\uff0etest for details.",
        "See evil\u3002example\u3002test for details.",
        "See evil\uff61com for details.",
        "See ev\u200bil.co\u200bm for details.",
        "See evil\u00ad.com for details.",
        "See evil[.]example[.]test for details.",
        "See evil (.) com for details.",
        "See evil(dot)com for details.",
        "See evil [dot] com for details.",
        "See evil\\.com for details.",
        "See evil&#46;com for details.",
        "See evil&#x2e;com for details.",
        "See EVIL.COM for details.",
        "See \uff45\uff56\uff49\uff4c.\uff43\uff4f\uff4d for details.",
        "See hxxp[:]//evil.example.test for details.",
        "See bücher.example for details.",
        # A trusted host name used as a disguise for another host.
        "See https://marrow.example.test.evil.com/ for details.",
        "See https://marrow.example.test@evil.com/ for details.",
        "See marrow.example.test:8443/ for details.",
        # A trusted host with a path outside the trusted link.
        "See https://code.example.test/attacker for details.",
        "See code.example.test/attacker for details.",
        "See https://code.example.test/ilsa-marrow/../attacker for details.",
        "See code.example.test/ilsa-marrow/%2e%2e/attacker for details.",
        "See https://code.example.test/ilsa-marrow-fake for details.",
        # IP literals in link form.
        "See http://192.0.2.10/x for details.",
        "See 192.0.2.10:8080 for details.",
        "See 192.0.2.10/x for details.",
        # A host the URL parser rejects (an IPv6 bracket left open or literal) is untrusted.
        "See http://[fe80::abcd]/x for details.",
        "See https://[evil for details.",
        "See //[x for details.",
        "See https://[::ab for details.",
        # A host label that starts with an underscore.
        "See _evil.com for details.",
    ],
)
def test_a_link_outside_the_trusted_set_is_replaced(text: str) -> None:
    assert finding(text) == "untrusted_url"


@pytest.mark.parametrize(
    "text",
    [
        "Write to x@evil.example.test for details.",
        "Write to x\uff20evil.example.test for details.",
        "Write to x [at] evil [dot] example [dot] test for details.",
        "Write to ilsa@marrow.example.test.evil.com for details.",
        "Write to ILSA@EVIL.EXAMPLE.TEST for details.",
    ],
)
def test_an_address_outside_the_trusted_one_is_replaced(text: str) -> None:
    assert finding(text) in {"untrusted_email", "untrusted_url"}


def test_a_contact_link_the_url_parser_rejects_is_skipped() -> None:
    contact = ContactCard(
        name="Ilsa Marrow",
        email="ilsa@marrow.example.test",
        links=[
            ContactLink(label="Broken", url="https://[broken"),
            ContactLink(label="Website", url="https://marrow.example.test/"),
        ],
    )
    assert finding("See marrow.example.test for her work.", contact=contact) is None
    assert finding("See evil.example.test for details.", contact=contact) == "untrusted_url"


def test_without_a_contact_card_every_link_is_untrusted() -> None:
    assert finding("See marrow.example.test for details.", contact=None) == "untrusted_url"


# --- Trusted links pass with and without a scheme -----------------------------------------------


@pytest.mark.parametrize(
    "text",
    [
        "See https://marrow.example.test/ for her work.",
        "See https://marrow.example.test for her work.",
        "See marrow.example.test for her work.",
        "See marrow.example.test/ for her work.",
        "See MARROW.EXAMPLE.TEST for her work.",
        "Her code is at https://code.example.test/ilsa-marrow.",
        "Her code is at code.example.test/ilsa-marrow.",
        "Her code is at code.example.test/ilsa-marrow/sample-project.",
        "Write to ilsa@marrow.example.test or mailto:ilsa@marrow.example.test.",
        "Write to ILSA@MARROW.EXAMPLE.TEST.",
        # The site's own record links, absolute and relative.
        "See https://marrow.example.test/experience#experience-acme-labs.",
        "See marrow.example.test/experience#experience-acme-labs.",
        "See marrow.example.test/ai-roadmap/learning-path (the roadmap).",
        "See /experience#experience-acme-labs for the role.",
        "See [the roadmap](/ai-roadmap) for more.",
        "See [the roadmap](marrow.example.test/ai-roadmap) for more.",
    ],
)
def test_trusted_contact_and_record_links_pass(text: str) -> None:
    assert finding(text) is None


# --- Ordinary text with dots is not a link ------------------------------------------------------


@pytest.mark.parametrize(
    "text",
    [
        # File names, including ones whose extension is also a top-level domain.
        "The guide is in README.md and the code in main.py.",
        "She wrote Main.java, lib.rs, deploy.sh and Build.pl.",
        "The app reads next.config.ts and src/app/page.tsx.",
        "The settings live in package.json, pyproject.toml and docker-compose.yml.",
        "The release ships as bundle.zip with a demo.mov.",
        "Her slides are in talk.pdf; the notes in notes.txt.",
        # Versions, numbers and dates.
        "She upgraded to v0.8.1 and Python 3.12.",
        "The build 1.2.3-beta replaced 1.2.2.",
        "The meetup was on 23.11.2026 at 18.30.",
        "Accuracy rose by 2.5 percent.",
        "The version 10.0.0.1 was the last.",
        # Abbreviations, also at the end of a sentence.
        "She holds a Ph.D. and an M.Sc. from a fictional university.",
        "She studied for a B.Sc., i.e. three years, e.g. in physics.",
        "She worked for Acme s.r.o. and Brno a.s. in the U.S.",
        "She worked for a fictional company, Inc.",
        "Tools: Node.js, Next.js, Vue.js and .NET.",
        # Technology names written like a host name.
        "She built it on ASP.NET, VB.NET, ADO.NET and ML.NET with Socket.IO.",
        "This is the end.Then a new sentence starts.",
        "Ilsa et al. published it, cf. the talk.",
        # Plain prose with colons that are not schemes.
        "Data: three years of work. Note: it was remote.",
        "The talk started at 10:30.",
        # A word after an opaque scheme's name is a word, not a link.
        "Read about:it later; the tel:fine print; irc:user names.",
        "She chose sip:none and data:less work.",
    ],
)
def test_ordinary_text_with_dots_is_not_a_link(text: str) -> None:
    assert finding(text) is None


@pytest.mark.parametrize(
    "text",
    [
        # Company names written as their domain are links: the name is the address.
        "She worked for Booking.com and Kiwi.com.",
        "She bought it at Alza.cz.",
        # A dotted word whose last part is a top-level domain.
        "Set user.name in the config.",
        "The 2.0.app release.",
        # A missing space after a full stop before a word that is a top-level domain.
        "She led the team.It shipped on time.",
    ],
)
def test_dotted_words_ending_in_a_top_level_domain_are_links(text: str) -> None:
    # A known limitation (docs/threat-model.md): without a scheme, such words cannot be told
    # from a host name, so they are replaced; the fictional seed has none of them.
    assert finding(text) == "untrusted_url"


def test_the_link_check_is_linear_in_the_text() -> None:
    texts = [
        "a." * 2000,
        "a-" * 2000 + ".com",
        "http:" * 800,
        "//" * 2000,
        "[.]" * 1300,
        "x" * 3990 + ".com",
        "s3:" + "a" * 3990,
        # Characters that NFKC expands up to sixfold, with and without an address in them.
        "\u3316" * 4000,
        "\u3316" * 1999 + "@" + "\u3316" * 2000,
        "a@" * 2000,
        "\ufdfa" * 4000,
    ]
    started = time.perf_counter()
    for text in texts:
        finding(text[:4000])
    assert time.perf_counter() - started < 0.5
