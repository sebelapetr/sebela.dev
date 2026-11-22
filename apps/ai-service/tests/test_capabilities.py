"""The public profile capability: the `get_profile` projection, bounded, with no generation data."""

from __future__ import annotations

import asyncio

from llm_agent import PublicPerson, profile_view

from ai_service.app import CapabilityLimits
from ai_service.models.fake import FakeModels
from tests.fakes import PERSON, FakeApi, running

ROUTE = "/v1/capabilities/profile"


async def test_the_profile_is_the_tool_projection_without_private_fields() -> None:
    api = FakeApi()
    async with running(api, FakeModels()) as (_, client):
        response = await client.get(ROUTE)
    assert response.status_code == 200
    payload = response.json()
    assert payload == profile_view(PublicPerson.model_validate(PERSON))
    assert payload["name"] == "Ilsa Marrow"
    assert {"id", "email", "links"}.isdisjoint(payload)


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
    assert api.person_reads == 2


async def test_no_generation_route_is_reachable_without_the_bearer() -> None:
    api = FakeApi()
    async with running(api, FakeModels()) as (_, client):
        for path in ("/internal/v1/generations", "/v1/capabilities/generations"):
            response = await client.get(path)
            assert response.status_code in (401, 404, 405)
