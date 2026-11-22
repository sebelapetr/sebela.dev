"""The API control client: a one-use claim and a result report with bounded retries."""

from __future__ import annotations

import datetime
import json
import time
from typing import Any

import httpx2
import pytest
from sebela_api_client.models import ChatGenerationResult, ChatGrantClaimed

from ai_service.clients.control_api import ControlApi
from ai_service.schemas import ResultReport
from tests.fakes import API_URL, CONTROL_TOKEN, FakeApi, error


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
    assert isinstance(first, ChatGrantClaimed)
    assert first.allowance_usd == 0.02
    assert (first.model, first.pricing_version) == ("claude-haiku-5-5", "anthropic-2026-11-19")
    assert first.effort == "medium"
    assert first.context_revision == 1
    assert first.deadline_at.tzinfo is not None
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


CLAIMED: dict[str, Any] = {
    "claimed": True,
    "deadlineAt": "2026-11-22T12:00:00.000Z",
    "allowanceUsd": 0.02,
    "model": "claude-haiku-5-5",
    "effort": "medium",
    "pricingVersion": "anthropic-2026-11-19",
    "contextRevision": 1,
}


def answering(status: int, body: object, seen: list[httpx2.Request]) -> httpx2.MockTransport:
    def handle(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        content = body if isinstance(body, bytes) else json.dumps(body).encode()
        headers = {"content-type": "application/json", "location": f"{API_URL}/elsewhere"}
        return httpx2.Response(status, content=content, headers=headers)

    return httpx2.MockTransport(handle)


async def test_a_claim_sends_the_contract_body_with_the_control_bearer() -> None:
    seen: list[httpx2.Request] = []
    control = ControlApi(API_URL, CONTROL_TOKEN, transport=answering(200, CLAIMED, seen))
    operation = "00000000-0000-4000-8000-00000000000a"
    try:
        claimed = await control.claim(operation, "grant-a")
    finally:
        await control.aclose()
    assert claimed is not None
    assert claimed.deadline_at == datetime.datetime(2026, 11, 22, 12, tzinfo=datetime.UTC)
    [request] = seen
    assert request.url.path == "/v1/internal/chat/grants/claim"
    assert request.headers["authorization"] == f"Bearer {CONTROL_TOKEN}"
    assert json.loads(request.content) == {"operationId": operation, "grant": "grant-a"}


@pytest.mark.parametrize(
    "body",
    [
        {**CLAIMED, "claimed": False},
        {**CLAIMED, "deadlineAt": "2026-11-22T12:00:00"},
        {**CLAIMED, "deadlineAt": "tomorrow"},
        {**CLAIMED, "allowanceUsd": 0},
        {**CLAIMED, "allowanceUsd": "0.02"},
        {**CLAIMED, "model": ""},
        {**CLAIMED, "effort": ""},
        {**CLAIMED, "effort": 7},
        {key: value for key, value in CLAIMED.items() if key != "effort"},
        {**CLAIMED, "pricingVersion": 7},
        {**CLAIMED, "contextRevision": -1},
        {**CLAIMED, "contextRevision": 1.5},
        {**CLAIMED, "contextRevision": True},
        {key: value for key, value in CLAIMED.items() if key != "contextRevision"},
        [CLAIMED],
        b"{not json",
    ],
)
async def test_a_claim_outside_the_contract_is_not_a_claim(body: object) -> None:
    seen: list[httpx2.Request] = []
    control = ControlApi(API_URL, CONTROL_TOKEN, transport=answering(200, body, seen))
    try:
        assert await control.claim("00000000-0000-4000-8000-00000000000a", "grant-a") is None
    finally:
        await control.aclose()


@pytest.mark.parametrize("status", [301, 302, 307, 308])
async def test_a_redirected_claim_is_not_followed(status: int) -> None:
    seen: list[httpx2.Request] = []
    control = ControlApi(API_URL, CONTROL_TOKEN, transport=answering(status, CLAIMED, seen))
    try:
        assert await control.claim("00000000-0000-4000-8000-00000000000a", "grant-a") is None
    finally:
        await control.aclose()
    assert len(seen) == 1


async def test_a_failing_api_is_not_a_claim() -> None:
    def broken(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError("refused", request=request)

    control = ControlApi(API_URL, CONTROL_TOKEN, transport=httpx2.MockTransport(broken))
    seen: list[httpx2.Request] = []
    failing = ControlApi(API_URL, CONTROL_TOKEN, transport=answering(500, error("x"), seen))
    try:
        assert await control.claim("00000000-0000-4000-8000-00000000000a", "grant-a") is None
        assert await failing.claim("00000000-0000-4000-8000-00000000000a", "grant-a") is None
    finally:
        await control.aclose()
        await failing.aclose()


async def test_a_report_sends_the_generated_contract_body() -> None:
    api = FakeApi()
    request = api.issue()
    result = report(request["grant"])
    control = ControlApi(API_URL, CONTROL_TOKEN, transport=api.transport())
    try:
        assert await control.report(request["operationId"], result, until=time.monotonic() + 5)
    finally:
        await control.aclose()
    sent = api.stored[request["operationId"]]
    assert sent == result.model_dump(mode="json", by_alias=True)
    assert ChatGenerationResult.from_dict(sent).to_dict() == sent


@pytest.mark.parametrize("status", [302, 400, 403, 409, 413])
async def test_a_redirected_or_refused_report_is_final(status: int) -> None:
    seen: list[httpx2.Request] = []
    control = ControlApi(API_URL, CONTROL_TOKEN, transport=answering(status, error("x"), seen))
    try:
        stored = await control.report(
            "00000000-0000-4000-8000-00000000000a",
            report("grant-a"),
            until=time.monotonic() + 5,
        )
    finally:
        await control.aclose()
    assert stored is False
    assert len(seen) == 1
