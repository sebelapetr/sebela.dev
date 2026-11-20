"""The public-read adapter over the generated content client, with an in-memory transport."""

from __future__ import annotations

import json
from typing import Any

import httpx2
import pytest

from llm_agent import ApiContentReader, ContentUnavailableError
from tests.unit.fakes import PERSON_ID

BASE_URL = "https://content.example.test"

PERSON_JSON: dict[str, Any] = {
    "id": PERSON_ID,
    "name": "Ilsa Marrow",
    "headline": "Fictional AI engineer",
    "shortBio": "A fictional engineer.",
    "longBio": None,
    "location": "Port Wren",
    "email": "ilsa@marrow.example.test",
    "links": [{"label": "Website", "url": "https://marrow.example.test/"}],
    "availability": None,
    "careerStartedOn": "2015-09-01",
    "servicesIntro": None,
    "collaborationSteps": [{"title": "Call", "description": "A short call."}],
    "servicesNote": None,
    "photoId": None,
    "cvPdfId": None,
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-01T00:00:00.000Z",
}


def transport(status: int, body: object, seen: list[httpx2.Request]) -> httpx2.MockTransport:
    def handle(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        return httpx2.Response(status, content=json.dumps(body).encode())

    return httpx2.MockTransport(handle)


async def test_the_reader_maps_the_public_person_and_sends_no_credentials() -> None:
    seen: list[httpx2.Request] = []
    async with ApiContentReader(BASE_URL, transport=transport(200, PERSON_JSON, seen)) as reader:
        person = await reader.read_person()
    assert person.id == PERSON_ID
    assert person.links[0].url == "https://marrow.example.test/"
    assert person.collaboration_steps[0].title == "Call"
    assert [(r.method, r.url.path) for r in seen] == [("GET", "/v1/person")]
    assert "authorization" not in {key.lower() for key in seen[0].headers}
    assert "x-api-key" not in {key.lower() for key in seen[0].headers}


@pytest.mark.parametrize(
    ("status", "body"),
    [
        (404, {"error": {"code": "not_found", "message": "No person."}}),
        (500, {"error": {"code": "internal", "message": "Failed."}}),
        (200, {"unexpected": True}),
    ],
)
async def test_a_missing_failed_or_malformed_read_is_unavailable(status: int, body: object) -> None:
    seen: list[httpx2.Request] = []
    async with ApiContentReader(BASE_URL, transport=transport(status, body, seen)) as reader:
        with pytest.raises(ContentUnavailableError):
            await reader.read_person()


async def test_a_connection_failure_is_unavailable() -> None:
    def refuse(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError("refused", request=request)

    async with ApiContentReader(BASE_URL, transport=httpx2.MockTransport(refuse)) as reader:
        with pytest.raises(ContentUnavailableError):
            await reader.read_person()


def test_only_http_base_urls_are_accepted() -> None:
    with pytest.raises(ValueError, match="http"):
        ApiContentReader("file:///etc/passwd")
