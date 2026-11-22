"""The fixed read capabilities: the in-process tools' projections, paged, bounded, read-only.

Every capability is one literal `GET /v1/capabilities/<name>` route over one read tool (the contact
read excluded). Its arguments are the tool's own, as query parameters, validated before any API
read; unknown names, unknown or repeated parameters and bad pages read nothing. Reads are bounded
in parallelism, time and rate. Parity with the in-process tools over the real API is proven in
`tests/integration/test_chat_stack.py`.
"""

from __future__ import annotations

import asyncio

import pytest
from llm_agent import ApiContentReader, profile_view

from ai_service.app import CapabilityLimits
from ai_service.models.fake import FakeModels
from tests.fakes import API_URL, CONTROL_TOKEN, PERSON, TOKEN, FakeApi, running

ROUTE = "/v1/capabilities/profile"

#: Every capability route, by the read tool behind it.
ROUTES = {
    "get_profile": "/v1/capabilities/profile",
    "list_experiences": "/v1/capabilities/experiences",
    "list_projects": "/v1/capabilities/projects",
    "get_project": "/v1/capabilities/project",
    "list_services": "/v1/capabilities/services",
    "list_explorations": "/v1/capabilities/explorations",
    "list_education": "/v1/capabilities/education",
    "list_current_focus": "/v1/capabilities/current-focus",
    "get_roadmap": "/v1/capabilities/roadmap",
    "get_roadmap_area": "/v1/capabilities/roadmap-area",
    "get_learning_diary": "/v1/capabilities/learning-diary",
    "get_learning_statistics": "/v1/capabilities/learning-statistics",
    "list_books": "/v1/capabilities/books",
    "list_events": "/v1/capabilities/events",
}


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


async def test_the_profile_is_one_record_of_the_tool_projection_without_private_fields() -> None:
    api = FakeApi()
    async with running(api, FakeModels()) as (_, client):
        response = await client.get(ROUTE)
    assert response.status_code == 200
    async with ApiContentReader(API_URL, transport=api.transport()) as content:
        expected = profile_view(await content.read_person())
    assert response.json() == {
        "capability": "get_profile",
        "page": 1,
        "pageCount": 1,
        "records": [
            {
                "kind": "profile",
                "id": "profile",
                "title": "Ilsa Marrow",
                "href": "/",
                "data": expected,
            }
        ],
    }
    text = response.text
    for private in (PERSON["id"], PERSON["email"], "marrow.example.test/", TOKEN, CONTROL_TOKEN):
        assert private not in text


async def test_the_capability_routes_are_exactly_the_read_tools_but_the_contact() -> None:
    api = FakeApi()
    async with running(api, FakeModels()) as (app, _):
        paths = {str(getattr(route, "path", "")) for route in app.routes}
    paths = {path for path in paths if path.startswith("/v1/capabilities")}
    assert paths == set(ROUTES.values())


async def test_the_capability_needs_no_bearer_and_ignores_one() -> None:
    api = FakeApi()
    async with running(api, FakeModels()) as (_, client):
        response = await client.get(ROUTE, headers={"authorization": "Bearer nonsense"})
    assert response.status_code == 200


async def test_an_unavailable_api_is_unavailable() -> None:
    api = FakeApi(person_status=500)
    async with running(api, FakeModels()) as (_, client):
        response = await client.get(ROUTE)
    assert response.status_code == 503
    assert response.json() == {"code": "unavailable"}


async def test_a_slow_api_times_out() -> None:
    api = FakeApi(person_delay_s=2.0)
    limits = CapabilityLimits(concurrency=2, timeout_s=0.2)
    async with running(api, FakeModels(), capability_limits=limits) as (_, client):
        started = asyncio.get_running_loop().time()
        response = await client.get(ROUTE)
        elapsed = asyncio.get_running_loop().time() - started
    assert response.status_code == 503
    assert response.json() == {"code": "unavailable"}
    assert elapsed < 1.0


async def test_concurrent_reads_beyond_the_bound_are_busy() -> None:
    api = FakeApi(person_delay_s=0.3)
    limits = CapabilityLimits(concurrency=2, timeout_s=2.0)
    async with running(api, FakeModels(), capability_limits=limits) as (_, client):
        responses = await asyncio.gather(*(client.get(ROUTE) for _ in range(4)))
    statuses = sorted(response.status_code for response in responses)
    assert statuses == [200, 200, 503, 503]
    assert sorted(response.json().get("code", "") for response in responses)[-2:] == ["busy"] * 2
    assert api.person_reads == 2


async def test_reads_beyond_the_rate_are_limited_until_the_window_passes() -> None:
    api = FakeApi()
    clock = Clock()
    limits = CapabilityLimits(rate=2, window_s=60.0, clock=clock)
    async with running(api, FakeModels(), capability_limits=limits) as (_, client):
        first = [(await client.get(ROUTE)).status_code for _ in range(2)]
        clock.now += 30
        limited = await client.get(ROUTE)
        clock.now += 30
        later = await client.get(ROUTE)
    assert first == [200, 200]
    assert limited.status_code == 429
    assert limited.json() == {"code": "rate_limited"}
    assert int(limited.headers["retry-after"]) == 30
    assert later.status_code == 200
    assert api.person_reads == 3


@pytest.mark.parametrize(
    "path",
    [
        "/v1/capabilities/contact",
        "/v1/capabilities/get_contact",
        "/v1/capabilities/get_profile",
        "/v1/capabilities",
        "/v1/capabilities/",
        "/v1/capabilities/profile/extra",
        "/v1/capabilities/conversations",
        "/v1/capabilities/chat/conversation",
        "/v1/capabilities/ledger",
        "/v1/capabilities/generations",
        "/v1/capabilities/compaction",
        "/v1/capabilities/audit",
        "/v1/capabilities/api-keys",
        "/v1/capabilities/media",
        "/v1/capabilities/%2E%2E/%2E%2E/v1/internal/chat/grants/claim",
        "/v1/capabilities/http:%2F%2Fapi.example.test%2Fv1%2Fperson",
        "/v1/internal/chat/operations",
        "/v1/person",
    ],
)
async def test_an_unknown_capability_is_not_found_and_reads_nothing(path: str) -> None:
    api = FakeApi()
    async with running(api, FakeModels()) as (_, client):
        response = await client.get(path)
    assert response.status_code == 404
    assert api.public_reads == []


@pytest.mark.parametrize(
    "query",
    [
        "/v1/capabilities/profile?slug=x",
        "/v1/capabilities/profile?url=http://api.example.test/v1/internal/chat",
        "/v1/capabilities/profile?page=0",
        "/v1/capabilities/profile?page=-1",
        "/v1/capabilities/profile?page=one",
        "/v1/capabilities/profile?page=99999999999999999999",
        "/v1/capabilities/profile?page=1&page=2",
        "/v1/capabilities/project",
        "/v1/capabilities/project?slug=",
        "/v1/capabilities/project?slug=../../v1/internal/chat",
        "/v1/capabilities/project?slug=a%3B%20DROP%20TABLE%20projects",
        "/v1/capabilities/project?slug=a&slug=b",
        "/v1/capabilities/project?slug=a&path=/etc/passwd",
        "/v1/capabilities/project?slug=a&command=ls",
        "/v1/capabilities/roadmap-area?area=" + "x" * 500,
        "/v1/capabilities/roadmap-area?slug=agents",
    ],
)
async def test_invalid_arguments_are_refused_before_any_read(query: str) -> None:
    api = FakeApi()
    async with running(api, FakeModels()) as (_, client):
        response = await client.get(query)
    assert response.status_code == 422
    assert response.json() == {"code": "invalid_arguments"}
    assert api.public_reads == []


async def test_a_page_beyond_the_result_is_refused() -> None:
    api = FakeApi()
    async with running(api, FakeModels()) as (_, client):
        response = await client.get(ROUTE + "?page=2")
    assert response.status_code == 422
    assert response.json() == {"code": "invalid_arguments"}


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
async def test_a_capability_cannot_be_written(method: str) -> None:
    api = FakeApi()
    async with running(api, FakeModels()) as (_, client):
        response = await client.request(method, ROUTE, json={"name": "Someone Else"})
    assert response.status_code == 405
    assert api.public_reads == []


async def test_no_generation_route_is_reachable_without_the_bearer() -> None:
    api = FakeApi()
    models = FakeModels()
    async with running(api, models) as (_, client):
        for path in ("/internal/v1/generations", "/v1/capabilities/generations"):
            response = await client.get(path)
            assert response.status_code in (401, 404, 405)
        body = api.issue()
        refused = await client.post("/internal/v1/generations", json=body)
        cancel = await client.post(f"/internal/v1/generations/{body['operationId']}/cancel")
        assert [refused.status_code, cancel.status_code] == [401, 401]
    assert api.claims == []
    assert models.calls == []
