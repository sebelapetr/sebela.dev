"""The committed OpenAPI document is the service's current one (`pnpm export:openapi`)."""

from __future__ import annotations

import json
from pathlib import Path

from ai_service.app import openapi_document

COMMITTED = Path(__file__).resolve().parent.parent / "openapi.json"


def test_the_committed_document_has_no_drift() -> None:
    committed = json.loads(COMMITTED.read_text(encoding="utf-8"))
    assert committed == openapi_document(), "run `pnpm --filter @sebela/ai-service export:openapi`"


def test_the_document_describes_the_routes_and_the_bearer() -> None:
    document = openapi_document()
    paths = document["paths"]
    assert set(paths) == {
        "/internal/v1/generations",
        "/internal/v1/generations/{operation_id}/cancel",
        "/v1/capabilities/profile",
        "/health",
        "/ready",
    }
    generation = paths["/internal/v1/generations"]["post"]
    assert generation["security"] == [{"bearer": []}]
    assert {"202", "401", "422", "503"} <= set(generation["responses"])
    assert "GenerationRequest" in document["components"]["schemas"]
    cancel = paths["/internal/v1/generations/{operation_id}/cancel"]["post"]
    assert cancel["security"] == [{"bearer": []}]
    assert {"202", "401", "422"} <= set(cancel["responses"])
    assert "requestBody" not in cancel
