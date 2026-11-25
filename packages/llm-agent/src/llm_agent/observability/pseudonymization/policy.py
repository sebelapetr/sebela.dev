"""Rules, owner-fact exceptions, scoped labels and recursive field filtering.

Rules remove every value of a fixed format (email, phone, secret, fixed ID). An optional detector
adds person and address findings. A detector finding that is exactly an API-supplied owner fact,
on word boundaries, stays readable; a longer value that merely contains one (`Ilsa Marrowfield`,
`3 Harbour Steps, Port Wren`) does not. Each finding becomes `[CATEGORY:label]`, where the label
is a keyed hash under a key that lives only in the `Scope`: the same value has the same label
within one trace and an unrelated one in any other, and no table maps a label back to its value.

This masks known shapes; it does not make arbitrary free text anonymous.
"""

from __future__ import annotations

import hashlib
import hmac
import re
import secrets
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Literal

if TYPE_CHECKING:
    from llm_agent.observability.pseudonymization.detector import Detector

Category = Literal["person", "address", "email", "phone", "secret", "fixed_id"]
Mode = Literal["rules", "detector"]


@dataclass(frozen=True)
class Finding:
    """One masked span, in the original text's offsets."""

    start: int
    end: int
    category: str


@dataclass(frozen=True)
class Masked:
    text: str
    findings: tuple[Finding, ...]
    #: `rules` without a detector (names and addresses are not masked), else `detector`.
    mode: Mode


@dataclass
class Scope:
    """One trace's labelling key. It is never exported and is discarded with the trace."""

    _key: bytes = field(default_factory=lambda: secrets.token_bytes(32), repr=False)

    def label(self, category: str, value: str) -> str:
        digest = hmac.new(self._key, f"{category}\0{value}".encode(), hashlib.sha256)
        return f"[{category.upper()}:{digest.hexdigest()[:8]}]"


# Rules in priority order: on overlap the earlier rule wins. A rule with a `v` group masks only it.
_RULES: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        "secret",
        re.compile(
            r"\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}"
            r"|\bgh[pousr]_[A-Za-z0-9]{20,}"
            r"|\bAKIA[A-Z0-9]{16}\b"
            r"|\bxox[abposr]-[A-Za-z0-9-]{10,}"
            r"|\beyJ[\w-]+\.[\w-]+\.[\w-]+"
        ),
    ),
    ("secret", re.compile(r"(?i)\bbearer\s+(?P<v>[^\s,;\"']+)")),
    (
        "secret",
        re.compile(
            r"(?i)\b(?:password|passwd|pwd|passcode|heslo|secret|token|api[_-]?key)"
            r"\s*[:=]\s*(?P<v>[^\s,;\"']+)"
        ),
    ),
    (
        "email",
        re.compile(
            r"[\w.+-]+(?:@|%40)[\w-]+(?:\.[\w-]+)+"
            r"|[\w.+-]+\s*[\[(](?:at|zavináč)[\])]\s*[\w-]+"
            r"(?:\s*[\[(](?:dot|tečka)[\])]\s*[\w-]+)+",
            re.IGNORECASE,
        ),
    ),
    ("fixed_id", re.compile(r"\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b")),
    ("fixed_id", re.compile(r"\b(?:\d{4}[ -]?){3}\d{4}\b")),
    (
        "fixed_id",
        re.compile(r"\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b"),
    ),
    ("fixed_id", re.compile(r"\b\d{6}/\d{3,4}\b")),
    ("fixed_id", re.compile(r"\b[A-Z]{2} ?\d{2} ?\d{2} ?\d{2} ?[A-D]\b")),
    (
        "phone",
        re.compile(
            r"(?:\+|\b00)\d{1,3}(?:[ .-]?\(?\d{1,4}\)?){2,5}\b"
            r"|\(\d{3}\) ?\d{3}-\d{4}\b"
            r"|\b0\d{4} ?\d{6}\b"
            r"|\b\d{3} \d{3} \d{3}\b"
        ),
    ),
)

#: Keys whose values are never exported, whatever an allowlist says: credentials, cookies,
#: headers, network identity, hidden reasoning and raw dumps.
DENIED_KEYS = frozenset(
    {
        "authorization",
        "api_key",
        "apikey",
        "cookie",
        "cookies",
        "set_cookie",
        "headers",
        "password",
        "secret",
        "token",
        "grant",
        "client_ip",
        "ip",
        "remote_addr",
        "x_forwarded_for",
        "user_agent",
        "fingerprint",
        "reasoning",
        "thinking",
        "raw",
        "dump",
        "media",
        "image",
        "attachment",
    }
)


def _rule_findings(text: str) -> list[Finding]:
    taken: list[Finding] = []
    for category, pattern in _RULES:
        for match in pattern.finditer(text):
            group = "v" if "v" in pattern.groupindex else 0
            start, end = match.span(group)
            if not any(start < other.end and other.start < end for other in taken):
                taken.append(Finding(start, end, category))
    return taken


def _is_owner_fact(text: str, finding: Finding, facts: Sequence[str]) -> bool:
    value = text[finding.start : finding.end]
    if value not in facts:
        return False
    before = text[finding.start - 1] if finding.start > 0 else " "
    after = text[finding.end] if finding.end < len(text) else " "
    return not (before.isalnum() or before == "-" or after.isalnum() or after == "-")


class Pseudonymizer:
    """Masks one text. With a detector it is CPU-bound: run it outside the event loop."""

    def __init__(self, detector: Detector | None = None) -> None:
        self._detector = detector

    @property
    def version(self) -> str:
        return self._detector.version if self._detector else "rules"

    def mask(self, text: str, facts: Sequence[str], *, scope: Scope | None = None) -> Masked:
        """Raises whatever the detector raises; the caller then drops the content."""
        scope = scope or Scope()
        findings = _rule_findings(text)
        if self._detector is not None:
            for found in self._detector.detect(text):
                if found.category not in ("person", "address"):
                    continue
                if _is_owner_fact(text, found, facts):
                    continue
                if any(found.start < o.end and o.start < found.end for o in findings):
                    continue
                findings.append(Finding(found.start, found.end, found.category))
        findings.sort(key=lambda finding: finding.start)
        parts: list[str] = []
        position = 0
        for finding in findings:
            parts.append(text[position : finding.start])
            parts.append(scope.label(finding.category, text[finding.start : finding.end]))
            position = finding.end
        parts.append(text[position:])
        mode: Mode = "rules" if self._detector is None else "detector"
        return Masked("".join(parts), tuple(findings), mode)


Json = str | int | float | bool | None | list["Json"] | dict[str, "Json"]


def _normal(key: str) -> str:
    return key.lower().replace("-", "_")


def filter_fields(
    value: Mapping[str, object],
    allowed: frozenset[str],
    pseudonymizer: Pseudonymizer,
    facts: Sequence[str],
    scope: Scope,
) -> dict[str, Json]:
    """Keeps only allowlisted, never-denied keys at every depth and masks every string kept.

    Values that are not JSON scalars, lists or mappings (bytes, objects, media) are dropped
    rather than converted, so no raw dump or binary reaches an export.
    """

    def mask(text: str) -> str:
        return pseudonymizer.mask(text, facts, scope=scope).text

    def walk(item: object) -> tuple[bool, Json]:
        if item is None or isinstance(item, bool | int | float):
            return True, item
        if isinstance(item, str):
            return True, mask(item)
        if isinstance(item, Mapping):
            return True, mapping(item)
        if isinstance(item, list | tuple):
            kept = [walked for ok, walked in map(walk, item) if ok]
            return True, kept
        return False, None

    def mapping(item: Mapping[Any, object]) -> dict[str, Json]:
        result: dict[str, Json] = {}
        for key, child in item.items():
            if not isinstance(key, str):
                continue
            normal = _normal(key)
            if normal in DENIED_KEYS or normal not in allowed:
                continue
            ok, walked = walk(child)
            if ok:
                result[key] = walked
        return result

    return mapping(value)
