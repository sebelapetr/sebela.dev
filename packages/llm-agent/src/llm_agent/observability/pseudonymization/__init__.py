"""Local pseudonymization of everything a trace export may carry (#214).

One interface: `Pseudonymizer(detector).mask(text, facts, scope=)` and `filter_fields(...)`, with
`open_detector(folder)` for the optional pinned local NER model. See `policy.py` for the rules and
exceptions and `detector.py` for the manifest and the accepted runtimes.
"""

from llm_agent.observability.pseudonymization.detector import (
    Detector,
    DetectorUnavailableError,
    Manifest,
    open_detector,
)
from llm_agent.observability.pseudonymization.policy import (
    DENIED_KEYS,
    Finding,
    Json,
    Masked,
    Pseudonymizer,
    Scope,
    filter_fields,
)

__all__ = [
    "DENIED_KEYS",
    "Detector",
    "DetectorUnavailableError",
    "Finding",
    "Json",
    "Manifest",
    "Masked",
    "Pseudonymizer",
    "Scope",
    "filter_fields",
    "open_detector",
]
