"""The optional local NER detector behind the pseudonymizer, and its pinned manifest.

A detector finds the free-form categories rules cannot (`person`, `address`). It is opened only
from a local folder whose `detector.json` pins the model, its revision, its licence, its runtime,
its threshold and the SHA-256 of every file; nothing is downloaded and no remote model code runs.
A runtime is usable only when an adapter for it is registered here, and an adapter is registered
only after its candidate met every frozen floor of `evals/pii` (`AGENTS.md`, Trace
pseudonymization). None has yet, so every manifest is refused and the export stays metadata-only.
Swapping a model is a new folder (and, for a new runtime, a new reviewed adapter), never a change
of the chat graph.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from llm_agent.observability.pseudonymization.policy import Finding


class Detector(Protocol):
    """Finds free-form personal data. `detect` is CPU-bound and may be slow; call it off-loop."""

    @property
    def version(self) -> str:
        """`<model>@<revision>`, recorded with every masked export."""
        ...

    def detect(self, text: str) -> Sequence[Finding]: ...


class DetectorUnavailableError(Exception):
    """The folder holds no usable, verified detector; the caller falls back to metadata only."""


@dataclass(frozen=True)
class Manifest:
    model: str
    revision: str
    license: str
    runtime: str
    threshold: float
    files: Mapping[str, str]


#: runtime name -> adapter that loads a verified folder. Empty until a candidate is accepted.
ADAPTERS: dict[str, Callable[[Path, Manifest], Detector]] = {}

_REQUIRED = ("model", "revision", "license", "runtime")


def _manifest(folder: Path) -> Manifest:
    path = folder / "detector.json"
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise DetectorUnavailableError(f"no readable detector.json in {folder}") from error
    if not isinstance(document, dict):
        raise DetectorUnavailableError("detector.json is not an object")
    for key in _REQUIRED:
        if not isinstance(document.get(key), str) or not document[key]:
            raise DetectorUnavailableError(f"detector.json has no pinned {key}")
    threshold = document.get("threshold")
    if not isinstance(threshold, int | float) or not 0 < threshold < 1:
        raise DetectorUnavailableError("detector.json has no threshold between 0 and 1")
    files = document.get("files")
    if not isinstance(files, dict) or not files:
        raise DetectorUnavailableError("detector.json lists no files with checksums")
    return Manifest(
        document["model"],
        document["revision"],
        document["license"],
        document["runtime"],
        float(threshold),
        {str(name): str(digest) for name, digest in files.items()},
    )


def _verify(folder: Path, manifest: Manifest) -> None:
    root = folder.resolve()
    for name, digest in manifest.files.items():
        path = (root / name).resolve()
        if not path.is_relative_to(root):
            raise DetectorUnavailableError(f"{name} lies outside the model folder")
        try:
            actual = hashlib.sha256(path.read_bytes()).hexdigest()
        except OSError as error:
            raise DetectorUnavailableError(f"{name} is missing") from error
        if actual != digest.lower():
            raise DetectorUnavailableError(f"{name} does not match its checksum")


def open_detector(folder: Path) -> Detector:
    """Loads the pinned detector in `folder`, or raises `DetectorUnavailableError`."""
    manifest = _manifest(folder)
    _verify(folder, manifest)
    adapter = ADAPTERS.get(manifest.runtime)
    if adapter is None:
        raise DetectorUnavailableError(f"runtime {manifest.runtime!r} has no accepted adapter")
    return adapter(folder, manifest)
