"""Synthetic stored case-run records for the deterministic eval tests (no model, no API)."""

from __future__ import annotations

import copy
from typing import Any

from evals.datasets.cases import DATASET_VERSION, FIXTURE_PERSON
from evals.graders.code import canonical_href, expected_block, fixture_contact
from evals.provider import RECORD_SCHEMA

PERSON_ID = "00000000-0000-4000-8000-000000000001"
SUBJECT = {"pipeline": "test-pipeline"}


#: The tool that reads each source kind.
TOOL = {
    "profile": "get_profile",
    "contact": "get_contact",
    "experience": "list_experiences",
    "project": "list_projects",
    "exploration": "list_explorations",
    "service": "list_services",
    "education": "list_education",
}


def evidence(ref: str, kind: str) -> dict[str, Any]:
    """Evidence of `kind` (the person) or of `kind:slug` (a fixture record)."""
    kind, _, slug = kind.partition(":")
    record_id = slug or PERSON_ID
    return {
        "ref": ref,
        "tool": TOOL[kind],
        "kind": kind,
        "record_id": record_id,
        "title": slug or "Ilsa Marrow",
        "href": canonical_href(kind, record_id),
        "data": {"name": FIXTURE_PERSON["name"]} if not slug else {"slug": slug},
    }


def block(block_type: str, slug: str) -> dict[str, Any]:
    built = expected_block(block_type, slug)
    assert built is not None
    return built


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
    blocks: tuple[dict[str, Any], ...] = (),
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
            "sources": [source(item["ref"], kind) for item, kind in zip(items, kinds, strict=True)]
            if cite
            else [],
            "blocks": list(blocks),
            "evidence": items,
            "usage": {"cost_usd": 0.001, "cost_uncertain": False},
            "trace": [span("stage.security", verdict=verdict), *tools],
        },
        "latency_ms": 10,
    }
