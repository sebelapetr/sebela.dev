"""A bounded shutdown: admission stops, running work drains, the rest is reported interrupted."""

from __future__ import annotations

import asyncio
import time

import httpx2

from ai_service.app import create_app
from ai_service.models.fake import FakeModels
from tests.fakes import FakeApi, bearer, settings

ROUTE = "/internal/v1/generations"


async def test_a_shutdown_stops_admission_and_reports_unfinished_work_as_interrupted() -> None:
    api = FakeApi()
    models = FakeModels("slow")
    app = create_app(
        settings(AI_SERVICE_SHUTDOWN_GRACE_S="0.3"), models=models, transport=api.transport()
    )
    body = api.issue()
    transport = httpx2.ASGITransport(app=app)
    async with httpx2.AsyncClient(transport=transport, base_url="http://service.test") as client:
        lifespan = app.router.lifespan_context(app)
        await lifespan.__aenter__()
        assert (await client.get("/ready")).status_code == 200
        assert (await client.post(ROUTE, json=body, headers=bearer())).status_code == 202
        await asyncio.sleep(0.1)
        started = time.monotonic()
        stopping = asyncio.ensure_future(lifespan.__aexit__(None, None, None))
        await asyncio.sleep(0.05)
        assert (await client.get("/ready")).status_code == 503
        assert (await client.get("/health")).status_code == 200
        refused = await client.post(ROUTE, json=api.issue(), headers=bearer())
        assert refused.status_code == 503
        assert refused.json() == {"code": "busy"}
        await stopping
        assert time.monotonic() - started < 5
    stored = api.stored[body["operationId"]]
    assert stored["outcome"] == "cancelled"
    assert stored["reason"] == "interrupted"
    assert stored["usage"]["costUncertain"] is True
    assert len(api.claims) == 1


async def test_work_that_finishes_within_the_grace_is_reported_normally() -> None:
    api = FakeApi()
    gate = asyncio.Event()
    models = FakeModels("slow", gate=gate)
    app = create_app(
        settings(AI_SERVICE_SHUTDOWN_GRACE_S="5"), models=models, transport=api.transport()
    )
    body = api.issue()
    transport = httpx2.ASGITransport(app=app)
    async with httpx2.AsyncClient(transport=transport, base_url="http://service.test") as client:
        lifespan = app.router.lifespan_context(app)
        await lifespan.__aenter__()
        assert (await client.post(ROUTE, json=body, headers=bearer())).status_code == 202
        await asyncio.sleep(0.1)
        stopping = asyncio.ensure_future(lifespan.__aexit__(None, None, None))
        await asyncio.sleep(0.1)
        gate.set()
        await stopping
    assert api.stored[body["operationId"]]["outcome"] == "answered"
