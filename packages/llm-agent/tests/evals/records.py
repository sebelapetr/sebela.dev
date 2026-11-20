"""Synthetic stored case-run records for the deterministic eval tests (no model, no API)."""

from __future__ import annotations

import copy
from typing import Any

from evals.datasets.cases import DATASET_VERSION, FIXTURE_PERSON
from evals.graders.code import fixture_contact
from evals.provider import RECORD_SCHEMA

PERSON_ID = "00000000-0000-4000-8000-000000000001"
SUBJECT = {"pipeline": "test-pipeline"}


def evidence(ref: str, kind: str) -> dict[str, Any]:
    href = "/" if kind == "profile" else "/#contact"
    tool = "get_profile" if kind == "profile" else "get_contact"
    return {
        "ref": ref,
        "tool": tool,
        "kind": kind,
        "record_id": PERSON_ID,
        "title": "Ilsa Marrow",
        "href": href,
        "data": {"name": FIXTURE_PERSON["name"]},
    }


def source(ref: str, kind: str) -> dict[str, Any]:
    item = evidence(ref, kind)
    return {key: item[key] for key in ("ref", "kind", "record_id", "title", "href")}


def span(name: str, status: str = "ok", **attributes: Any) -> dict[str, Any]:
    return {"name": name, "status": status, "duration_ms": 1, "attributes": attributes}


def record(
    case_id: str,
    *,
    outcome: str = "answered",
    language: str = "en",
    text: str = "Ilsa Marrow is a fictional engineer.",
    kinds: tuple[str, ...] = ("profile",),
    cite: bool = True,
    contact: bool = False,
    verdict: str = "ALLOW",
    repeat: int = 1,
) -> dict[str, Any]:
    items = [evidence(f"src-{index}", kind) for index, kind in enumerate(kinds, start=1)]
    tools = [span(f"tool.{item['tool']}") for item in items]
    return {
        "record_schema": RECORD_SCHEMA,
        "case_id": case_id,
        "repeat": repeat,
        "fingerprint": {
            "dataset_version": DATASET_VERSION,
            "record_schema": RECORD_SCHEMA,
            "subject": copy.deepcopy(SUBJECT),
        },
        "result": {
            "outcome": outcome,
            "reason": None,
            "language": language,
            "text": text,
            "contact": fixture_contact() if contact else None,
            "sources": [source(item["ref"], item["kind"]) for item in items] if cite else [],
            "evidence": items,
            "usage": {"cost_usd": 0.001, "cost_uncertain": False},
            "trace": [span("stage.security", verdict=verdict), *tools],
        },
        "latency_ms": 10,
    }
