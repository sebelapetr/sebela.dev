"""The trace pseudonymizer (#214): rules, owner-fact exceptions, scoped labels, field filtering
and the pinned local detector. All values are fictional."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

import pytest

from llm_agent.observability.pseudonymization import (
    DetectorUnavailableError,
    Finding,
    Manifest,
    Pseudonymizer,
    Scope,
    filter_fields,
    open_detector,
)
from llm_agent.observability.pseudonymization import detector as detector_module

FACTS = ("Ilsa Marrow", "Port Wren", "Brindle Labs")


@dataclass(frozen=True)
class _Detector:
    """Finds the given names wherever they occur, as a person."""

    names: tuple[str, ...]
    version: str = "fake-detector@1"

    def detect(self, text: str) -> Sequence[Finding]:
        found: list[Finding] = []
        for name in self.names:
            start = text.find(name)
            while start >= 0:
                found.append(Finding(start, start + len(name), "person"))
                start = text.find(name, start + 1)
        return found


class _BrokenDetector:
    version = "broken@1"

    def detect(self, text: str) -> Sequence[Finding]:
        raise RuntimeError("model crashed")


@pytest.mark.parametrize(
    ("text", "value", "category"),
    [
        ("Write to tomas.herrera@northwind.example.com now", "tomas.herrera@", "email"),
        ("to=mia.chen%40lumen.example.org from", "mia.chen%40", "email"),
        ("rafael.costa [at] seaview [dot] example or", "rafael.costa", "email"),
        ("na m.svoboda [zavináč] example [tečka] cz.", "m.svoboda", "email"),
        ("call +44 20 7946 0958 today", "7946 0958", "phone"),
        ("ring (555) 010-0199.", "010-0199", "phone"),
        ("Volejte 00420 602 111 222 nebo", "602 111 222", "phone"),
        ("nebo 602 333 444 a", "602 333 444", "phone"),
        ("mobile 07700 900123.", "900123", "phone"),
        ("key sk-ant-api03-Zx9fakefakefakefakefakeFAKE00, ok", "Zx9fake", "secret"),
        ("Authorization: Bearer abc.def-ghi", "abc.def-ghi", "secret"),
        ("token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJl", "eyJhbGci", "secret"),
        ("My password: Tr0ub4dor&3x in case", "Tr0ub4dor", "secret"),
        ("Moje heslo: Kocka-Leze-Dirou9 kdyby", "Kocka-Leze", "secret"),
        ("is ghp_FAKE0000aaaa1111bbbb2222cccc3333dddd.", "ghp_FAKE", "secret"),
        ("The AWS key AKIAFAKE0000EXAMPLE1 belongs", "AKIAFAKE", "secret"),
        ("bot xoxb-FAKE-0000-1111-aaaabbbbcccc, please", "xoxb-FAKE", "secret"),
        ("card 4111 1111 1111 1111 was", "4111 1111", "fixed_id"),
        ("IBAN GB82 WEST 1234 5698 7654 32.", "5698 7654", "fixed_id"),
        ("IBAN: CZ65 0800 0000 1920 0014 5399, kontakt", "1920 0014", "fixed_id"),
        ("from 203.0.113.42; I'm", "203.0.113.42", "fixed_id"),
        ("Rodné číslo 905512/1236 tam", "905512/1236", "fixed_id"),
        ("number is QQ 12 34 56 C.", "QQ 12 34 56 C", "fixed_id"),
    ],
)
def test_the_rules_remove_every_fixed_format_value(text: str, value: str, category: str) -> None:
    masked = Pseudonymizer().mask(text, FACTS)
    assert value not in masked.text
    assert [finding.category for finding in masked.findings] == [category]
    assert f"[{category.upper()}:" in masked.text


def test_addresses_with_house_numbers_and_postal_codes_are_not_phones() -> None:
    text = "Kancelář je na Vinohradská 1511/230, 100 00 Praha 10 a Kounicova 5, 602 00 Brno."
    assert Pseudonymizer().mask(text, FACTS).findings == ()


def test_findings_are_in_the_original_offsets() -> None:
    text = "a@b.example and +420 777 123 456"
    masked = Pseudonymizer().mask(text, FACTS)
    assert [(text[f.start : f.end], f.category) for f in masked.findings] == [
        ("a@b.example", "email"),
        ("+420 777 123 456", "phone"),
    ]


def test_without_a_detector_names_are_left_and_the_mode_says_rules_only() -> None:
    masked = Pseudonymizer().mask("I'm Daniel Okafor.", FACTS)
    assert masked.text == "I'm Daniel Okafor."
    assert masked.mode == "rules"


def test_detector_findings_are_masked_and_owner_facts_stay_readable() -> None:
    detector = _Detector(("Daniel Okafor", "Ilsa Marrow"))
    masked = Pseudonymizer(detector).mask("Daniel Okafor asks if Ilsa Marrow is free.", FACTS)
    assert "Daniel Okafor" not in masked.text
    assert "Ilsa Marrow is free" in masked.text
    assert masked.text.startswith("[PERSON:")
    assert masked.mode == "detector"


@pytest.mark.parametrize(
    "visitor",
    ["Ilsa Marrowfield", "Ilsa Marrow-Quinn", "Ilsa Marrow Smith", "3 Harbour Steps, Port Wren"],
)
def test_an_owner_fact_cannot_whitelist_a_longer_visitor_value(visitor: str) -> None:
    detector = _Detector((visitor,))
    masked = Pseudonymizer(detector).mask(f"I'm {visitor}, hello.", FACTS)
    assert visitor not in masked.text


def test_the_same_value_gets_the_same_label_within_a_scope_only() -> None:
    detector = _Detector(("Mia Chen",))
    pseudonymizer = Pseudonymizer(detector)
    scope = Scope()
    first = pseudonymizer.mask("Mia Chen wrote.", FACTS, scope=scope).text
    second = pseudonymizer.mask("Ask Mia Chen.", FACTS, scope=scope).text
    other = pseudonymizer.mask("Mia Chen wrote.", FACTS, scope=Scope()).text
    assert first.split()[0] == second.split()[1].rstrip(".")
    assert first != other


def test_a_scope_holds_no_reversal_table() -> None:
    scope = Scope()
    Pseudonymizer().mask("write to lena@marsh.example", FACTS, scope=scope)
    assert "lena" not in repr(vars(scope))


def test_a_failing_detector_raises_rather_than_returning_unmasked_names() -> None:
    with pytest.raises(RuntimeError):
        Pseudonymizer(_BrokenDetector()).mask("Daniel Okafor", FACTS)


def test_filter_fields_keeps_allowlisted_keys_and_masks_their_strings() -> None:
    value = {
        "stage": "main",
        "tool": {"name": "read_profile", "result": "mail a@b.example"},
        "headers": {"authorization": "Bearer abc"},
        "cookie": "session=1",
        "client_ip": "203.0.113.42",
        "reasoning": "hidden",
        "nested": [{"stage": "guard", "raw": "dump"}],
    }
    allowed = frozenset({"stage", "tool", "name", "result", "nested", "headers", "cookie"})
    filtered = filter_fields(value, allowed, Pseudonymizer(), FACTS, Scope())
    tool = filtered["tool"]
    assert filtered["stage"] == "main"
    assert isinstance(tool, dict)
    assert tool["name"] == "read_profile"
    assert isinstance(tool["result"], str)
    assert "a@b.example" not in tool["result"]
    assert filtered["nested"] == [{"stage": "guard"}]
    # Credentials, cookies, headers, raw IPs and hidden reasoning are refused even if allowed.
    for key in ("headers", "cookie", "client_ip", "reasoning"):
        assert key not in filtered


def test_filter_fields_decodes_nothing_it_cannot_mask() -> None:
    value = {"stage": b"raw bytes", "name": 3, "result": None, "flag": True}
    allowed = frozenset({"stage", "name", "result", "flag"})
    filtered = filter_fields(value, allowed, Pseudonymizer(), FACTS, Scope())
    assert filtered == {"name": 3, "result": None, "flag": True}


def _model_folder(tmp_path: Path, **overrides: object) -> Path:
    tmp_path.mkdir(parents=True, exist_ok=True)
    weights = tmp_path / "model.onnx"
    weights.write_bytes(b"fictional weights")
    manifest: dict[str, object] = {
        "model": "example/ner",
        "revision": "0123456789abcdef",
        "license": "apache-2.0",
        "runtime": "onnx-token-classification",
        "threshold": 0.5,
        "files": {"model.onnx": hashlib.sha256(b"fictional weights").hexdigest()},
    }
    manifest.update(overrides)
    (tmp_path / "detector.json").write_text(json.dumps(manifest), encoding="utf-8")
    return tmp_path


def test_open_detector_refuses_a_folder_without_a_manifest(tmp_path: Path) -> None:
    with pytest.raises(DetectorUnavailableError, match=r"detector\.json"):
        open_detector(tmp_path)


def test_open_detector_refuses_a_checksum_mismatch(tmp_path: Path) -> None:
    folder = _model_folder(tmp_path, files={"model.onnx": "0" * 64})
    with pytest.raises(DetectorUnavailableError, match="checksum"):
        open_detector(folder)


def test_open_detector_refuses_a_file_outside_the_folder(tmp_path: Path) -> None:
    folder = _model_folder(tmp_path / "m", files={"../escape": "0" * 64})
    with pytest.raises(DetectorUnavailableError, match="outside"):
        open_detector(folder)


def test_open_detector_refuses_a_manifest_without_a_pinned_revision(tmp_path: Path) -> None:
    folder = _model_folder(tmp_path, revision="")
    with pytest.raises(DetectorUnavailableError, match="revision"):
        open_detector(folder)


def test_open_detector_refuses_a_runtime_without_an_accepted_adapter(tmp_path: Path) -> None:
    # No candidate has passed the frozen corpus yet, so no runtime adapter is registered.
    with pytest.raises(DetectorUnavailableError, match="no accepted adapter"):
        open_detector(_model_folder(tmp_path))


def _candidate(seen: list[Manifest]) -> Callable[[Path, Manifest], _Detector]:
    def load(folder: Path, manifest: Manifest) -> _Detector:
        seen.append(manifest)
        return _Detector(("Daniel Okafor",), version=f"{manifest.model}@{manifest.revision}")

    return load


def test_an_evaluation_candidate_loads_only_for_evaluation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen: list[Manifest] = []
    monkeypatch.setitem(detector_module.CANDIDATES, "onnx-token-classification", _candidate(seen))
    folder = _model_folder(tmp_path)
    # A candidate under evaluation is not accepted: the export never opens it.
    with pytest.raises(DetectorUnavailableError, match="no accepted adapter"):
        open_detector(folder)
    detector = open_detector(folder, evaluation=True)
    assert detector.version == "example/ner@0123456789abcdef"
    assert seen[0].license == "apache-2.0"
    assert seen[0].threshold == 0.5


def test_an_evaluation_candidate_still_needs_a_verified_folder(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen: list[Manifest] = []
    monkeypatch.setitem(detector_module.CANDIDATES, "onnx-token-classification", _candidate(seen))
    folder = _model_folder(tmp_path, files={"model.onnx": "0" * 64})
    with pytest.raises(DetectorUnavailableError, match="checksum"):
        open_detector(folder, evaluation=True)
    assert seen == []


def test_an_accepted_adapter_is_also_available_for_evaluation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen: list[Manifest] = []
    monkeypatch.setitem(detector_module.ADAPTERS, "onnx-token-classification", _candidate(seen))
    folder = _model_folder(tmp_path)
    assert open_detector(folder).version == open_detector(folder, evaluation=True).version
    assert len(seen) == 2


def test_without_a_registered_candidate_evaluation_refuses_the_runtime(tmp_path: Path) -> None:
    # No candidate runtime is installed yet (its dependency awaits the owner's approval).
    with pytest.raises(DetectorUnavailableError, match="no candidate adapter"):
        open_detector(_model_folder(tmp_path), evaluation=True)
