"""Scores the trace pseudonymizer on the frozen local corpus (free, no model provider call).

    python -m evals.pii
        the rules alone, without a detector
    python -m evals.pii --detector <model-folder>
        the rules with the pinned local detector in that folder (`detector.json` names the model,
        its revision, file checksums, licence and threshold; nothing is downloaded), opened as a
        candidate under evaluation: an installed candidate adapter or an accepted one

Prints the counts and recall/precision per language and category, the detector's version and the
time it took, and exits 1 when any frozen floor is missed or the corpus is not the one the floors
were frozen with, or the detector is unavailable; 2 for bad usage.
"""

from __future__ import annotations

import sys
import time
from collections.abc import Sequence
from pathlib import Path

from evals.pii import MaskedLike, load_corpus, load_floors, report, score
from llm_agent.observability.pseudonymization import (
    Detector,
    DetectorUnavailableError,
    Pseudonymizer,
    open_detector,
)

USAGE = "usage: python -m evals.pii [--detector <model-folder>]\n"


def main(argv: Sequence[str]) -> int:
    detector: Detector | None = None
    if argv:
        if len(argv) != 2 or argv[0] != "--detector":
            sys.stderr.write(USAGE)
            return 2
        started = time.monotonic()
        try:
            detector = open_detector(Path(argv[1]), evaluation=True)
        except DetectorUnavailableError as error:
            sys.stderr.write(f"detector unavailable: {error}\n")
            return 1
        print(f"detector: {detector.version} (loaded in {time.monotonic() - started:.1f} s)")
    else:
        print("detector: none (rules only)")
    corpus = load_corpus()
    floors = load_floors()
    if corpus.digest != floors.corpus_sha256:
        print(f"corpus {corpus.digest} is not the frozen corpus {floors.corpus_sha256}")
        return 1
    pseudonymizer = Pseudonymizer(detector)

    def mask(text: str, facts: Sequence[str]) -> MaskedLike:
        return pseudonymizer.mask(text, facts)

    started = time.monotonic()
    result = score(corpus, mask)
    elapsed = time.monotonic() - started
    print(f"corpus: {corpus.version} ({len(corpus.entries)} entries, {elapsed:.2f} s)")
    print(report(result))
    for miss in result.misses:
        print(f"  {miss}")
    failures = result.failures(floors)
    for failure in failures:
        print(f"FLOOR MISSED: {failure}")
    print("floors: " + ("missed" if failures else "met"))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
