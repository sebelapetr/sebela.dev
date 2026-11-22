"""`POST /internal/v1/generations/{operationId}/cancel`: the API's Stop of one generation.

The bearer comes first; the answer is 202 whether the operation runs here or not, so a caller
learns nothing about other operations. A running operation stops its graph, model and tool work
and reports `cancelled (stopped)`; other operations run on. A cancel that arrives before the claim
prevents the claim, and one that arrives during the claim stops before any model call.
"""

from __future__ import annotations

import asyncio
import uuid

from ai_service.models.fake import FakeModels
from tests.fakes import CONTROL_TOKEN, FakeApi, bearer, running

ROUTE = "/internal/v1/generations"


def cancel_path(operation: str) -> str:
    return f"{ROUTE}/{operation}/cancel"


async def wait_for(condition: object, timeout_s: float = 5.0) -> None:
    async with asyncio.timeout(timeout_s):
        while not condition():  # type: ignore[operator]
            await asyncio.sleep(0.01)


async def test_a_cancel_without_the_bearer_is_refused_before_anything_else() -> None:
    api = FakeApi()
    models = FakeModels("slow")
    async with running(api, models) as (_, client):
        body = api.issue()
        assert (await client.post(ROUTE, json=body, headers=bearer())).status_code == 202
        await wait_for(lambda: models.calls)
        path = cancel_path(body["operationId"])
        missing = await client.post(path)
        wrong = await client.post(path, headers=bearer("x" * 40))
        control = await client.post(path, headers=bearer(CONTROL_TOKEN))
        unauthenticated_garbage = await client.post(cancel_path("not-a-uuid"))
        assert [
            missing.status_code,
            wrong.status_code,
            control.status_code,
            unauthenticated_garbage.status_code,
        ] == [401, 401, 401, 401]
        assert api.stored == {}
        invalid = await client.post(cancel_path("not-a-uuid"), headers=bearer())
        assert invalid.status_code == 422
        assert (await client.post(path, headers=bearer())).status_code == 202
        await api.wait_reported()


async def test_a_stop_ends_the_running_generation_and_isolates_the_others() -> None:
    api = FakeApi()
    gate = asyncio.Event()
    models = FakeModels("slow", gate=gate)
    stopped, other = api.issue(), api.issue()
    async with running(api, models) as (_, client):
        for body in (stopped, other):
            assert (await client.post(ROUTE, json=body, headers=bearer())).status_code == 202
        await wait_for(lambda: len(models.calls) == 2)
        response = await client.post(cancel_path(stopped["operationId"]), headers=bearer())
        assert response.status_code == 202
        assert response.json() == {"accepted": True}
        await api.wait_reported()
        assert other["operationId"] not in api.stored
        gate.set()
        await api.wait_reported(2)
    result = api.stored[stopped["operationId"]]
    assert result["outcome"] == "cancelled"
    assert result["reason"] == "stopped"
    # The Security call was in flight: its charge is unknown, so the reservation stays.
    assert result["usage"]["costUncertain"] is True
    assert api.stored[other["operationId"]]["outcome"] == "answered"
    # The stopped operation made no Main call; the other made its whole journey.
    assert models.calls.count("security") == 2
    assert models.calls.count("main") == 2


async def test_a_duplicate_or_late_cancel_changes_nothing() -> None:
    api = FakeApi()
    models = FakeModels()
    body = api.issue()
    async with running(api, models) as (_, client):
        assert (await client.post(ROUTE, json=body, headers=bearer())).status_code == 202
        await api.wait_reported()
        for _ in range(2):
            late = await client.post(cancel_path(body["operationId"]), headers=bearer())
            assert late.status_code == 202
        await asyncio.sleep(0.05)
    assert api.stored[body["operationId"]]["outcome"] == "answered"
    assert len(api.report_attempts) == 1


async def test_an_unknown_operation_is_accepted_without_effect() -> None:
    api = FakeApi()
    models = FakeModels()
    async with running(api, models) as (_, client):
        response = await client.post(cancel_path(str(uuid.uuid4())), headers=bearer())
    assert response.status_code == 202
    assert api.claims == []
    assert models.calls == []


async def test_a_cancel_before_the_dispatch_prevents_the_claim() -> None:
    api = FakeApi()
    models = FakeModels()
    body = api.issue()
    async with running(api, models) as (_, client):
        assert (await client.post(cancel_path(body["operationId"]), headers=bearer())).is_success
        assert (await client.post(ROUTE, json=body, headers=bearer())).status_code == 202
        await asyncio.sleep(0.1)
    assert api.claims == []
    assert models.calls == []
    assert api.report_attempts == []


async def test_a_cancel_during_the_claim_stops_before_any_model_call() -> None:
    api = FakeApi(claim_delay_s=0.2)
    models = FakeModels()
    body = api.issue()
    async with running(api, models) as (_, client):
        assert (await client.post(ROUTE, json=body, headers=bearer())).status_code == 202
        await api.claim_started.wait()
        assert (await client.post(cancel_path(body["operationId"]), headers=bearer())).is_success
        await api.wait_reported()
    result = api.stored[body["operationId"]]
    assert (result["outcome"], result["reason"]) == ("cancelled", "stopped")
    assert result["usage"] == {
        "costUsd": 0,
        "costUncertain": False,
        "inputTokens": 0,
        "outputTokens": 0,
        "modelAttempts": 0,
    }
    assert models.calls == []
