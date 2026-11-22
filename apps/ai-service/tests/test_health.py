"""Liveness and readiness: no paid probe and no API call."""

from __future__ import annotations

from ai_service.models.fake import FakeModels
from tests.fakes import FakeApi, running


async def test_health_and_ready_answer_without_any_call() -> None:
    api = FakeApi()
    models = FakeModels()
    async with running(api, models) as (_, client):
        health = await client.get("/health")
        ready = await client.get("/ready")
    assert health.status_code == 200
    assert health.json() == {"status": "ok"}
    assert ready.status_code == 200
    assert ready.json() == {"status": "ready"}
    assert models.calls == []
    assert api.person_reads == 0
    assert api.claims == []
