"""The local result model, tied field by field to the API document it reports to.

`ResultReport` stays a validating Pydantic model, so a result outside the contract fails inside the
service before anything leaves it. The API document (`packages/api-client/src/generated/
openapi.json`, generated from the TypeScript contract) is the source of truth: this test fails as
soon as a field, its requiredness, its type, its enumeration or one of its bounds drifts apart.
The grant claim needs no local copy: the control client returns the generated `ChatGrantClaimed`.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from ai_service.schemas import ResultReport

DOCUMENT = Path(__file__).resolve().parents[3] / "packages/api-client/src/generated/openapi.json"
#: The bounds both sides must state alike wherever the API document states them.
BOUNDS = ("minLength", "maxLength", "minItems", "maxItems", "minimum", "exclusiveMinimum")


def _api() -> dict[str, Any]:
    schemas: dict[str, Any] = json.loads(DOCUMENT.read_text())["components"]["schemas"]
    return schemas


def _local() -> tuple[dict[str, Any], dict[str, Any]]:
    schema = ResultReport.model_json_schema(by_alias=True, mode="serialization")
    return schema, schema.get("$defs", {})


def _resolve(schema: dict[str, Any], defs: dict[str, Any]) -> dict[str, Any]:
    while "$ref" in schema:
        schema = defs[schema["$ref"].rsplit("/", 1)[-1]]
    return schema


def _nullable(schema: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    """The schema without a `null` alternative, and whether it had one."""
    options = schema.get("anyOf")
    if options is None:
        return schema, False
    rest = [option for option in options if option.get("type") != "null"]
    if len(rest) == 1 and len(rest) < len(options):
        return rest[0], True
    return schema, False


def _tie(
    path: str,
    local: dict[str, Any],
    local_defs: dict[str, Any],
    api: dict[str, Any],
    api_defs: dict[str, Any],
) -> list[str]:
    local, local_null = _nullable(_resolve(local, local_defs))
    api, api_null = _nullable(_resolve(api, api_defs))
    local, api = _resolve(local, local_defs), _resolve(api, api_defs)
    drift: list[str] = []
    if local_null != api_null:
        drift.append(f"{path}: nullable {local_null} here, {api_null} in the API document")
    if "type" in api and local.get("type") != api["type"]:
        drift.append(f"{path}: type {local.get('type')} here, {api['type']} in the API document")
    if "enum" in api and sorted(local.get("enum", [])) != sorted(api["enum"]):
        drift.append(f"{path}: enum {local.get('enum')} here, {api['enum']} in the API document")
    drift.extend(
        f"{path}: {bound} {local.get(bound)} here, {api[bound]} in the API document"
        for bound in BOUNDS
        if bound in api and local.get(bound) != api[bound]
    )
    if "properties" in api and "properties" in local:
        if (
            api.get("additionalProperties") is False
            and local.get("additionalProperties") is not False
        ):
            drift.append(f"{path}: unknown fields are allowed here, not in the API document")
        names, api_names = set(local["properties"]), set(api["properties"])
        if names != api_names:
            drift.append(f"{path}: fields {sorted(names)} here, {sorted(api_names)} in the API")
        required, api_required = set(local.get("required", [])), set(api.get("required", []))
        if required != api_required:
            drift.append(f"{path}: required {sorted(required)} here, {sorted(api_required)} there")
        for name in sorted(names & api_names):
            drift.extend(
                _tie(
                    f"{path}.{name}",
                    local["properties"][name],
                    local_defs,
                    api["properties"][name],
                    api_defs,
                )
            )
    if "items" in api and "items" in local:
        drift.extend(_tie(f"{path}[]", local["items"], local_defs, api["items"], api_defs))
    return drift


def test_the_result_report_matches_the_api_documents_generation_result() -> None:
    local, local_defs = _local()
    api = _api()
    assert _tie("ChatGenerationResult", local, local_defs, api["ChatGenerationResult"], api) == []


def test_the_tie_notices_a_drift() -> None:
    local, local_defs = _local()
    api = json.loads(json.dumps(_api()))
    result = api["ChatGenerationResult"]
    result["properties"]["usage"]["properties"]["cachedTokens"] = {"type": "integer"}
    result["properties"]["text"]["maxLength"] = 100
    result["properties"]["outcome"]["enum"].append("deferred")
    drift = _tie("ChatGenerationResult", local, local_defs, result, api)
    assert len(drift) == 3


@pytest.mark.parametrize("name", ["ChatGrantClaimed", "ChatGenerationResult", "ChatGrantClaim"])
def test_the_control_schemas_are_in_the_api_document(name: str) -> None:
    assert name in _api()
