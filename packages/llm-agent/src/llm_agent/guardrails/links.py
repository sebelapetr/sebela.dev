"""The Output Guard's check of links and e-mail addresses in a draft's text (#395).

`link_finding` reports the first link or address in the text that is outside the trusted contact
data, or None. A link is recognised in every form a reader or a renderer could follow:

- with a scheme: any `scheme://`, a special scheme (`http`, `https`, `ftp`, `ws`, `wss` and the
  defanged `hxxp`) followed by any number of slashes or none, and the opaque schemes that need no
  slashes (`javascript:`, `data:`, `mailto:`, `tel:` and the like);
- protocol-relative (`//host`);
- a bare host name: dot-separated labels whose last label is a top-level domain (`tlds`) or whose
  first label is `www`, with an optional port and path; an IPv4 address counts only with a port,
  a path, a scheme or `//`;
- the target of a markdown link, which is one of the forms above.

The check runs on a folded copy of the text, so a disguised link is seen as the link it spells:
invisible characters are dropped, Unicode compatibility forms (fullwidth letters and dots) and
case are folded, the ideographic full stop becomes a dot, a dot or `@` written in brackets
(`[.]`, `(dot)`, `[at]`), escaped (`\\.`) or as an HTML character reference becomes the
character, and a backslash becomes a slash, as browsers read it.

A link with a host is trusted when its host and port equal those of an `http`/`https` contact link
and its path, percent-decoded with dot segments resolved, is that link's path or below it; its
scheme, if it has one, is `http` or `https`, and it has no user information. The Website contact
link so admits the site's own record links with or without a scheme, and a relative path has no
host and is not a link. Any other link is trusted only as an exact contact link (case and a
trailing slash aside). An address is trusted only as the contact e-mail address, also as `mailto:`.

Ordinary text with dots is not a link: versions and numbers end in a number, abbreviations
(`e.g.`, `Ph.D.`, `s.r.o.`) have one-letter labels, and a name whose last label is a common file
extension that is also a top-level domain (`README.md`, `main.py`) is a file name, and a
technology name (`ASP.NET`, `Socket.IO`) a name, unless a scheme, `//`, `www`, a port or a path
marks it as a link. An opaque scheme name followed by a plain word (`about:it`, `tel:fine`) is a
word; `javascript:` and `vbscript:` are links whatever follows. A host the URL parser rejects (an
unclosed IPv6 bracket) is untrusted, and such a contact link trusts nothing. The scan, the address
check included, is linear in the length of the folded text.

Not recognised, and recorded in `docs/threat-model.md`: a host whose top-level domain is one of
those file extensions (`evil.zip`), a host spelled out with spaces (`evil dot com`, `evil . com`)
or with a middle dot, a bare IPv4 address, a hexadecimal or decimal IPv4 address, a word after an
opaque scheme name (`skype:evilname`), and a top-level domain written with look-alike letters of
another script, which no registry delegates. Replaced although not meant as a link, also recorded
there: a dotted word whose last label is a top-level domain (`Booking.com`, `user.name`,
`2.0.app`) and a missing space after a full stop before such a word (`team.It`).
"""

from __future__ import annotations

import posixpath
import re
import unicodedata
from dataclasses import dataclass
from typing import Final, Literal
from urllib.parse import unquote, urlsplit

from llm_agent.guardrails.tlds import TOP_LEVEL_DOMAINS
from llm_agent.schemas import ContactCard

LinkFinding = Literal["untrusted_url", "untrusted_email"]

#: Invisible characters outside the categories Cf, Mn and Me (Hangul fillers, braille blank).
_INVISIBLE: Final = frozenset("\u115f\u1160\u3164\uffa0\u2800")

#: File extensions that are also top-level domains; such a name is read as a file name.
_FILE_EXTENSIONS: Final = frozenset(
    {
        "ac",
        "am",
        "bz",
        "cc",
        "cr",
        "java",
        "map",
        "md",
        "mk",
        "ml",
        "mm",
        "mov",
        "pid",
        "pl",
        "pm",
        "properties",
        "ps",
        "py",
        "rs",
        "sc",
        "sh",
        "so",
        "sv",
        "tf",
        "zip",
    }
)
#: Technology names written like a host name; read as names unless a scheme, `//`, `www`, a port
#: or a path marks them as a link.
_TECHNOLOGY_NAMES: Final = frozenset({"ado.net", "asp.net", "ml.net", "socket.io", "vb.net"})
#: Schemes a browser follows without `//`, and schemes that never need it.
_SPECIAL_SCHEMES: Final = frozenset({"http", "https", "ftp", "ws", "wss", "hxxp", "hxxps"})
_OPAQUE_SCHEMES: Final = (
    "javascript|vbscript|data|file|mailto|tel|sms|callto|skype|facetime|intent|blob|magnet"
    "|about|jar|view-source|geo|market|itms|whatsapp|tg|viber|xmpp|irc|sip|sips"
)
#: Opaque schemes that run code whatever follows them; any other opaque scheme followed by a plain
#: word ("about:it", "tel:fine") is a word with a colon, not a link.
_SCRIPT_SCHEMES: Final = frozenset({"javascript", "vbscript"})

_BRACKETED: Final = re.compile(
    r"\s{0,3}[\[({<]\s{0,3}(\.|dot|tecka|tečka|@|at|zavinac|zavináč|:)\s{0,3}[\])}>]\s{0,3}"
)
_ENTITY: Final = re.compile(
    r"&(?:#0{0,8}(46|64|58|47)|#x0{0,8}(2e|40|3a|2f)|(period|commat|colon|sol));"
)
_ENTITY_CHARS: Final = {
    "46": ".",
    "2e": ".",
    "period": ".",
    "64": "@",
    "40": "@",
    "commat": "@",
    "58": ":",
    "3a": ":",
    "colon": ":",
    "47": "/",
    "2f": "/",
    "sol": "/",
}
_BRACKETED_CHARS: Final = {
    "dot": ".",
    "tecka": ".",
    "tečka": ".",
    "at": "@",
    "zavinac": "@",
    "zavináč": "@",
}

#: Where a link may start: a scheme, `//` or the first label of a host.
_START: Final = re.compile(
    r"(?<![\w+.\-])(?:"
    rf"(?P<opaque>{_OPAQUE_SCHEMES}):(?=[^\s/])"
    r"|(?P<scheme>[a-z][a-z0-9+.\-]{0,31}):(?P<slashes>/*)"
    r"|(?P<relative>(?<![:/])//)(?=[^\s/])"
    r"|(?P<host>\w)"
    r")"
)
#: The rest of a link after its start: up to whitespace, a quote or a closing bracket.
_REST: Final = re.compile(r"[^\s<>\"'`)\]}]*")
#: A run of host characters.
_RUN: Final = re.compile(r"[\w.\-]+")
#: An address; it starts only where a run of address characters starts, so the scan is linear.
_EMAIL: Final = re.compile(r"(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_PORT: Final = re.compile(r":(\d{1,5})(?!\w)")
_TRAILING: Final = "/.,;:!?"


def invisible(char: str) -> bool:
    """An invisible character: a format character (zero-width space, joiner, soft hyphen), a
    combining or enclosing mark (variation selector, combining grapheme joiner) or a filler."""
    return unicodedata.category(char) in {"Cf", "Mn", "Me"} or char in _INVISIBLE


@dataclass(frozen=True)
class _Trusted:
    hosts: tuple[tuple[str, int | None, str], ...]
    exact: frozenset[str]
    email: str


@dataclass(frozen=True)
class _Link:
    #: The scheme as written (folded), or None for a bare host or `//host`.
    scheme: str | None
    #: The authority and everything after it, or the opaque part of an opaque scheme.
    rest: str


def link_finding(text: str, contact: ContactCard | None) -> LinkFinding | None:
    """The first reason a link or address of the text is untrusted, or None."""
    folded = folded_view(text)
    trusted = _trusted(contact)
    for link in _links(folded):
        if not _is_trusted(link, trusted):
            return "untrusted_url"
    for email in _EMAIL.findall(folded):
        if not trusted.email or email.rstrip(".") != trusted.email:
            return "untrusted_email"
    return None


def folded_view(text: str) -> str:
    """The text as a link in it reads: invisible characters dropped, compatibility forms and case
    folded, and disguised dots, `@`, colons and slashes written as the characters."""
    visible = "".join(char for char in text if not invisible(char))
    folded = unicodedata.normalize("NFKC", visible).casefold()
    folded = folded.replace("\u3002", ".").replace("\\.", ".")
    folded = _ENTITY.sub(lambda m: _ENTITY_CHARS[next(g for g in m.groups() if g)], folded)
    folded = _BRACKETED.sub(lambda m: _BRACKETED_CHARS.get(m.group(1), m.group(1)), folded)
    return folded.replace("\\", "/")


def _trusted(contact: ContactCard | None) -> _Trusted:
    if contact is None:
        return _Trusted((), frozenset(), "")
    hosts: list[tuple[str, int | None, str]] = []
    exact: set[str] = set()
    for link in contact.links:
        url = link.url.strip()
        exact.add(url.rstrip("/").casefold())
        try:
            parts = urlsplit(url)
            port = parts.port
        except ValueError:
            # A contact link the URL parser rejects (an unclosed IPv6 bracket) trusts no host.
            continue
        if parts.scheme.casefold() in {"http", "https"} and parts.hostname:
            hosts.append((parts.hostname.casefold(), port, _resolved(parts.path)))
    return _Trusted(tuple(hosts), frozenset(exact), (contact.email or "").casefold())


def _links(folded: str) -> list[_Link]:
    """Every link of the folded text, in order, in one linear scan."""
    links: list[_Link] = []
    size = len(folded)
    index = 0
    while index < size:
        match = _START.search(folded, index)
        if match is None:
            break
        opaque = match.group("opaque")
        if opaque:
            rest = _REST.match(folded, match.end())
            end = rest.end() if rest else match.end()
            payload = folded[match.end() : end]
            if opaque not in _SCRIPT_SCHEMES and payload.rstrip(_TRAILING).isalpha():
                index = _bare_host(folded, match.start(), links)
                continue
            links.append(_Link(opaque, payload))
            index = end
            continue
        scheme = match.group("scheme")
        if scheme is not None:
            slashes = match.group("slashes")
            if len(slashes) >= 2 or (scheme in _SPECIAL_SCHEMES and _starts_host(folded, match)):
                rest = _REST.match(folded, match.end())
                end = rest.end() if rest else match.end()
                links.append(_Link(scheme, folded[match.end() : end]))
                index = max(end, match.end())
                continue
            # A word followed by a colon ("Note:", "10:30"): read it as a possible host instead.
            index = _bare_host(folded, match.start(), links)
            continue
        if match.group("relative"):
            rest = _REST.match(folded, match.end())
            end = rest.end() if rest else match.end()
            links.append(_Link(None, folded[match.end() : end]))
            index = end
            continue
        index = _bare_host(folded, match.start(), links)
    return links


def _starts_host(folded: str, match: re.Match[str]) -> bool:
    end = match.end()
    return end < len(folded) and (folded[end].isalnum() or folded[end] == "[")


def _bare_host(folded: str, start: int, links: list[_Link]) -> int:
    """Read a bare host at `start`, add it to `links` if it is one, and return where to go on."""
    run = _RUN.match(folded, start)
    if run is None:
        return start + 1
    end = run.end()
    if start > 0 and folded[start - 1] == "@":
        # The domain of an e-mail address; the address check covers it.
        return end
    name = run.group().rstrip(".-")
    labels = name.split(".")
    if len(labels) < 2 or not all(labels):
        return max(end, start + 1)
    after = start + len(name)
    port = _PORT.match(folded, after)
    tail_start = port.end() if port else after
    has_path = tail_start < len(folded) and folded[tail_start] in "/?#"
    marked = bool(port) or has_path
    if (name in _TECHNOLOGY_NAMES and not marked) or not _is_host(labels, marked=marked):
        return max(end, start + 1)
    rest = _REST.match(folded, tail_start) if has_path else None
    stop = rest.end() if rest else tail_start
    links.append(_Link(None, folded[start:stop]))
    return max(stop, end)


def _is_host(labels: list[str], *, marked: bool) -> bool:
    last = labels[-1]
    if labels[0] == "www":
        return True
    if all(label.isdecimal() for label in labels):
        return marked and len(labels) == 4 and all(int(label) <= 255 for label in labels)
    if not (last.isalpha() or last.startswith("xn--")):
        return False
    if last in _FILE_EXTENSIONS and not marked:
        return False
    try:
        ascii_last = last.encode("idna").decode("ascii")
    except UnicodeError:
        return False
    return ascii_last in TOP_LEVEL_DOMAINS


def _is_trusted(link: _Link, trusted: _Trusted) -> bool:
    scheme = link.scheme
    if scheme == "mailto":
        address = link.rest.rstrip(_TRAILING)
        return bool(trusted.email) and address == trusted.email
    if scheme is not None and scheme not in {"http", "https"}:
        return f"{scheme}:{link.rest}".rstrip(_TRAILING) in trusted.exact
    rest = link.rest.lstrip("/")
    try:
        parts = urlsplit("//" + rest.rstrip(_TRAILING))
        port = parts.port
    except ValueError:
        # The URL parser rejects the host (an unclosed or malformed IPv6 bracket): untrusted.
        return False
    host = (parts.hostname or "").rstrip(".")
    if not host or "@" in parts.netloc:
        return False
    path = _resolved(parts.path)
    for trusted_host, trusted_port, trusted_path in trusted.hosts:
        if host == trusted_host and port == trusted_port and _within(path, trusted_path):
            return True
    return False


def _resolved(path: str) -> str:
    """The path percent-decoded, with dot segments resolved, starting with `/`."""
    decoded = unquote(path)
    resolved = posixpath.normpath("/" + decoded.lstrip("/"))
    # `normpath` keeps two leading slashes; one is the same root here.
    return "/" + resolved.lstrip("/")


def _within(path: str, base: str) -> bool:
    if base == "/":
        return True
    base = base.rstrip("/")
    return path == base or path.startswith(base + "/")
