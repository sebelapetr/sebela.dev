"""The API control client: a one-use claim and a result report with bounded retries."""

from __future__ import annotations

import time

from ai_service.clients.control_api import ControlApi
from ai_service.schemas import ResultReport
from tests.fakes import API_URL, CONTROL_TOKEN, FakeApi


def report(grant: str) -> ResultReport:
    return ResultReport.model_validate(
        {
            "grant": grant,
            "outcome": "answered",
            "reason": None,
            "language": "en",
            "text": "Ilsa Marrow is a fictional engineer.",
            "blocks": [],
            "sources": [],
            "related": [],
            "usage": {
                "costUsd": 0.001,
                "costUncertain": False,
                "inputTokens": 1,
                "outputTokens": 1,
                "modelAttempts": 1,
            },
            "versions": {"mainModel": "claude-haiku-5-5"},
            "latencyMs": 10,
        }
    )


async def test_a_claim_returns_the_grant_terms_once() -> None:
    api = FakeApi()
    request = api.issue()
    control = ControlApi(API_URL, CONTROL_TOKEN, transport=api.transport())
    try:
        first = await control.claim(request["operationId"], request["grant"])
        second = await control.claim(request["operationId"], request["grant"])
    finally:
        await control.aclose()
    assert first is not None
    assert first.allowance_usd == 0.02
    assert second is None


async def test_a_wrong_grant_is_not_claimed() -> None:
    api = FakeApi()
    request = api.issue()
    control = ControlApi(API_URL, CONTROL_TOKEN, transport=api.transport())
    try:
        assert await control.claim(request["operationId"], "grant-wrong") is None
    finally:
        await control.aclose()


async def test_a_failing_report_is_retried_until_it_is_stored() -> None:
    api = FakeApi(report_failures=[503, 502])
    request = api.issue()
    control = ControlApi(API_URL, CONTROL_TOKEN, transport=api.transport())
    try:
        stored = await control.report(
            request["operationId"], report(request["grant"]), until=time.monotonic() + 5
        )
    finally:
        await control.aclose()
    assert stored is True
    assert len(api.report_attempts) == 3
    assert request["operationId"] in api.stored


async def test_a_refused_report_is_not_retried() -> None:
    api = FakeApi()
    request = api.issue()
    control = ControlApi(API_URL, CONTROL_TOKEN, transport=api.transport())
    try:
        stored = await control.report(
            request["operationId"], report("grant-wrong"), until=time.monotonic() + 5
        )
    finally:
        await control.aclose()
    assert stored is False
    assert len(api.report_attempts) == 1


async def test_the_retries_stop_at_their_bound() -> None:
    api = FakeApi(report_failures=[503] * 100)
    request = api.issue()
    control = ControlApi(API_URL, CONTROL_TOKEN, transport=api.transport())
    started = time.monotonic()
    try:
        stored = await control.report(
            request["operationId"], report(request["grant"]), until=started + 1.0
        )
    finally:
        await control.aclose()
    assert stored is False
    assert time.monotonic() - started < 1.5
    assert 1 < len(api.report_attempts) < 10
