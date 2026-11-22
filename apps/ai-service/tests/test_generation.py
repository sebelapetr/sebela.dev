"""The internal generation route: bearer, admission, the one-use grant, the deadline, reconcile."""

from __future__ import annotations

import asyncio
import datetime

from ai_service.models.fake import FakeModels
from tests.fakes import CONTROL_TOKEN, FakeApi, bearer, running, settings

ROUTE = "/internal/v1/generations"


async def test_a_request_without_the_bearer_is_refused_before_anything_else() -> None:
    api = FakeApi()
    models = FakeModels()
    async with running(api, models) as (_, client):
        missing = await client.post(ROUTE, json=api.issue())
        wrong = await client.post(ROUTE, json=api.issue(), headers=bearer("x" * 40))
        control = await client.post(ROUTE, json=api.issue(), headers=bearer(CONTROL_TOKEN))
        garbage = await client.post(
            ROUTE, content=b"{not json", headers={"authorization": "Basic x"}
        )
    assert [missing.status_code, wrong.status_code, control.status_code, garbage.status_code] == [
        401,
        401,
        401,
        401,
    ]
    assert api.claims == []
    assert models.calls == []


async def test_an_invalid_body_is_refused() -> None:
    api = FakeApi()
    models = FakeModels()
    async with running(api, models) as (_, client):
        broken = await client.post(ROUTE, content=b"{not json", headers=bearer())
        body = {**api.issue(), "allowanceUsd": 0.5}
        too_much = await client.post(ROUTE, json=body, headers=bearer())
        extra = await client.post(ROUTE, json={**api.issue(), "scenario": "fail"}, headers=bearer())
    assert [broken.status_code, too_much.status_code, extra.status_code] == [422, 422, 422]
    assert api.claims == []


async def test_an_answer_is_accepted_claimed_generated_and_reconciled_once() -> None:
    api = FakeApi()
    models = FakeModels()
    body = api.issue()
    async with running(api, models) as (_, client):
        response = await client.post(ROUTE, json=body, headers=bearer())
        assert response.status_code == 202
        assert response.json() == {"accepted": True}
        await api.wait_reported()
    stored = api.stored[body["operationId"]]
    assert stored["outcome"] == "answered"
    assert stored["grant"] == body["grant"]
    assert "Ilsa Marrow" in stored["text"]
    assert stored["sources"][0]["record"]["kind"] == "person"
    assert stored["usage"]["modelAttempts"] == 3
    assert models.calls == ["security", "main", "main"]
    assert len(api.report_attempts) == 1


async def test_four_running_operations_make_the_fifth_busy_without_a_claim() -> None:
    api = FakeApi()
    gate = asyncio.Event()
    models = FakeModels("slow", gate=gate)
    service = settings(AI_SERVICE_ADMISSION_WAIT_S="0.2")
    async with running(api, models, service) as (_, client):
        for _ in range(4):
            accepted = await client.post(ROUTE, json=api.issue(), headers=bearer())
            assert accepted.status_code == 202
        started = asyncio.get_running_loop().time()
        busy = await client.post(ROUTE, json=api.issue(), headers=bearer())
        waited = asyncio.get_running_loop().time() - started
        assert busy.status_code == 503
        assert busy.json() == {"code": "busy"}
        assert 0.15 <= waited < 1.0
        assert len(api.claims) == 4
        gate.set()
        await api.wait_reported(4)
    assert len(api.stored) == 4


async def test_a_freed_slot_within_the_wait_admits_the_next_operation() -> None:
    api = FakeApi()
    gate = asyncio.Event()
    models = FakeModels("slow", gate=gate)
    service = settings(AI_SERVICE_MAX_OPERATIONS="1", AI_SERVICE_ADMISSION_WAIT_S="2")
    async with running(api, models, service) as (_, client):
        assert (await client.post(ROUTE, json=api.issue(), headers=bearer())).status_code == 202
        asyncio.get_running_loop().call_later(0.2, gate.set)
        second = await client.post(ROUTE, json=api.issue(), headers=bearer())
        assert second.status_code == 202
        await api.wait_reported(2)


async def test_a_refused_claim_makes_no_model_call() -> None:
    api = FakeApi()
    models = FakeModels()
    body = {**api.issue(), "grant": "grant-forged"}
    async with running(api, models) as (_, client):
        response = await client.post(ROUTE, json=body, headers=bearer())
        assert response.status_code == 202
        for _ in range(50):
            if api.claims:
                break
            await asyncio.sleep(0.01)
        await asyncio.sleep(0.1)
    assert len(api.claims) == 1
    assert models.calls == []
    assert api.report_attempts == []


async def test_a_replay_after_a_restart_makes_no_second_model_call() -> None:
    api = FakeApi()
    models = FakeModels()
    body = api.issue()
    async with running(api, models) as (_, client):
        assert (await client.post(ROUTE, json=body, headers=bearer())).status_code == 202
        await api.wait_reported()
    calls = list(models.calls)
    restarted = FakeModels()
    async with running(api, restarted) as (_, client):
        assert (await client.post(ROUTE, json=body, headers=bearer())).status_code == 202
        await asyncio.sleep(0.2)
    assert restarted.calls == []
    assert models.calls == calls
    assert len(api.claims) == 2
    assert len(api.stored) == 1
    assert len(api.report_attempts) == 1


async def test_the_deadline_is_never_reset_by_the_claim() -> None:
    api = FakeApi()
    models = FakeModels("slow")
    later = datetime.datetime.now(datetime.UTC) + datetime.timedelta(seconds=60)
    api.claim_deadline = later.isoformat().replace("+00:00", "Z")
    body = api.issue(deadline_s=1.0)
    async with running(api, models) as (_, client):
        started = asyncio.get_running_loop().time()
        assert (await client.post(ROUTE, json=body, headers=bearer())).status_code == 202
        await api.wait_reported(timeout_s=5)
        elapsed = asyncio.get_running_loop().time() - started
    stored = api.stored[body["operationId"]]
    assert stored["outcome"] == "limit_reached"
    assert stored["reason"] == "deadline"
    assert elapsed < 2.5


async def test_an_expired_deadline_makes_no_model_call() -> None:
    api = FakeApi()
    models = FakeModels()
    body = api.issue(deadline_s=-1.0)
    async with running(api, models) as (_, client):
        assert (await client.post(ROUTE, json=body, headers=bearer())).status_code == 202
        await api.wait_reported()
    assert models.calls == []
    stored = api.stored[body["operationId"]]
    assert (stored["outcome"], stored["reason"]) == ("limit_reached", "deadline")


async def test_a_smaller_claimed_allowance_wins() -> None:
    api = FakeApi(claim_allowance=0.000001)
    models = FakeModels()
    body = api.issue()
    async with running(api, models) as (_, client):
        assert (await client.post(ROUTE, json=body, headers=bearer())).status_code == 202
        await api.wait_reported()
    assert api.stored[body["operationId"]]["outcome"] == "limit_reached"


async def test_a_failing_reconcile_is_retried_through_the_service() -> None:
    api = FakeApi(report_failures=[503, 500])
    models = FakeModels()
    body = api.issue()
    async with running(api, models) as (_, client):
        assert (await client.post(ROUTE, json=body, headers=bearer())).status_code == 202
        await api.wait_reported()
    assert len(api.report_attempts) == 3
    assert models.calls == ["security", "main", "main"]


async def test_a_version_mismatch_is_refused_before_admission() -> None:
    api = FakeApi()
    models = FakeModels()
    async with running(api, models) as (_, client):
        response = await client.post(
            ROUTE, json={**api.issue(), "model": "claude-other"}, headers=bearer()
        )
    assert response.status_code == 422
    assert response.json() == {"code": "version_mismatch"}
    assert api.claims == []


async def test_the_refuse_and_fail_scenarios_reconcile_their_outcomes() -> None:
    for scenario, outcome in (("refuse", "refused"), ("fail", "unavailable")):
        api = FakeApi()
        body = api.issue()
        service = settings(AI_SERVICE_FAKE_SCENARIO=scenario)
        async with running(api, None, service) as (_, client):
            assert (await client.post(ROUTE, json=body, headers=bearer())).status_code == 202
            await api.wait_reported()
        assert api.stored[body["operationId"]]["outcome"] == outcome


async def test_the_paid_mode_ceiling_stops_before_any_model_call() -> None:
    api = FakeApi()
    service = settings(
        AI_SERVICE_MODEL="anthropic",
        AI_SERVICE_ALLOW_PAID="true",
        AI_SERVICE_DAILY_CEILING_USD="0.03",
        ANTHROPIC_API_KEY="fictional-key",
    )
    first, second = api.issue(), api.issue()
    gate = asyncio.Event()
    slow = FakeModels("slow", gate=gate)
    async with running(api, slow, service) as (_, client):
        assert (await client.post(ROUTE, json=first, headers=bearer())).status_code == 202
        assert (await client.post(ROUTE, json=second, headers=bearer())).status_code == 202
        await api.wait_reported(1)
        stopped = api.stored[second["operationId"]]
        assert (stopped["outcome"], stopped["reason"]) == ("unavailable", "daily_ceiling")
        gate.set()
        await api.wait_reported(2)
    assert slow.calls.count("security") == 1
