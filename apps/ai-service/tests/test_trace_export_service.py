"""The trace export through the whole service (#214): dispatch, claim, answer, register, export.

The fictional API and trace store capture every outbound request, so these tests prove what
leaves the service, and that a failing or refusing trace path never changes an answer.
"""

from __future__ import annotations

import json
from typing import Any

from ai_service.models.fake import FakeModels
from tests.fakes import (
    CONTROL_TOKEN,
    LANGFUSE_ENV,
    LANGFUSE_SECRET,
    PERSON,
    TOKEN,
    FakeApi,
    FakeLangfuse,
    bearer,
    running,
    settings,
)

GENERATIONS = "/internal/v1/generations"
COMPACTIONS = "/internal/v1/compactions"

#: A fictional visitor question full of values that must never reach a trace store.
QUESTION = (
    "I'm Daniel Okafor from 12 Elm Row, Port Wren; mail daniel.okafor@northwind.example.com, "
    "call +44 20 7946 0958, my key is sk-ant-api03-Zx9fakefakefakefakefakeFAKE00 and my IP "
    "203.0.113.42. What does Ilsa Marrow build?"
)


def _spans(body: dict[str, Any]) -> list[dict[str, Any]]:
    return list(body["resourceSpans"][0]["scopeSpans"][0]["spans"])


def _root(body: dict[str, Any]) -> dict[str, str]:
    (root,) = [span for span in _spans(body) if "parentSpanId" not in span]
    return {item["key"]: item["value"]["stringValue"] for item in root["attributes"]}


async def _answered(
    api: FakeApi, store: FakeLangfuse | None, body: dict[str, Any], **env: str
) -> dict[str, Any]:
    create: dict[str, Any] = {}
    if store is not None:
        create["telemetry_transport"] = store.transport()
    async with running(api, FakeModels(), settings(**env), **create) as (_, client):
        response = await client.post(GENERATIONS, json=body, headers=bearer())
        assert response.status_code == 202, response.text
        await api.wait_reported()
        if store is not None and api.telemetry_export == "allowed" and not store.failures:
            await store.wait()
    return api.stored[body["operationId"]]


async def test_an_answer_is_registered_and_exported_without_any_visitor_or_secret_value() -> None:
    api, store = FakeApi(), FakeLangfuse()
    body = {**api.issue(), "question": QUESTION}
    stored = await _answered(api, store, body, **LANGFUSE_ENV)
    ((operation, registration),) = api.registrations
    assert operation == body["operationId"]
    assert registration["grant"] == body["grant"]
    (request,) = store.requests
    payload = request.content.decode()
    headers = json.dumps(dict(request.headers))
    forbidden = [
        QUESTION,
        "Daniel Okafor",
        "12 Elm Row",
        "daniel.okafor",
        "7946 0958",
        "sk-ant-api03",
        "203.0.113.42",
        body["grant"],
        body["operationId"],
        TOKEN,
        CONTROL_TOKEN,
        LANGFUSE_SECRET,
        PERSON["email"],
        stored["text"],
    ]
    for value in forbidden:
        assert value not in payload, value
        assert value not in headers, value
    exported = json.loads(payload)
    assert {span["traceId"] for span in _spans(exported)} == {registration["traceId"]}
    root = _root(exported)
    assert root["langfuse.trace.name"] == "chat.answer"
    assert root["langfuse.trace.metadata.outcome"] == stored["outcome"]
    assert root["langfuse.trace.metadata.export_mode"] == "metadata"


async def test_a_compaction_is_exported_as_its_own_trace() -> None:
    api, store = FakeApi(), FakeLangfuse()
    body = api.issue_compaction()
    async with running(
        api, FakeModels(), settings(**LANGFUSE_ENV), telemetry_transport=store.transport()
    ) as (_, client):
        response = await client.post(COMPACTIONS, json=body, headers=bearer())
        assert response.status_code == 202, response.text
        await api.wait_reported()
        await store.wait()
    assert _root(store.bodies[0])["langfuse.trace.name"] == "chat.compact"
    for exchange in body["exchanges"]:
        assert exchange["question"] not in store.requests[0].content.decode()


async def test_a_failing_trace_store_never_changes_the_answer() -> None:
    plain_api = FakeApi()
    plain = await _answered(plain_api, None, plain_api.issue())
    api, store = FakeApi(), FakeLangfuse(failures=[503, 503, 503])
    failing = await _answered(api, store, api.issue(), **LANGFUSE_ENV)
    for key in ("outcome", "reason", "language", "text", "usage"):
        assert failing[key] == plain[key]


async def test_a_refused_registration_exports_nothing_and_the_answer_stands() -> None:
    api, store = FakeApi(telemetry_export="refused"), FakeLangfuse()
    stored = await _answered(api, store, api.issue(), **LANGFUSE_ENV)
    assert stored["outcome"] == "answered"
    assert len(api.registrations) == 1
    assert store.requests == []


async def test_without_langfuse_settings_nothing_is_registered_or_exported() -> None:
    api, store = FakeApi(), FakeLangfuse()
    stored = await _answered(api, store, api.issue())
    assert stored["outcome"] == "answered"
    assert api.registrations == []
    assert store.requests == []


async def test_a_refused_claim_registers_no_trace() -> None:
    api, store = FakeApi(), FakeLangfuse()
    body = {**api.issue(), "grant": "grant-not-issued"}
    async with running(
        api, FakeModels(), settings(**LANGFUSE_ENV), telemetry_transport=store.transport()
    ) as (_, client):
        response = await client.post(GENERATIONS, json=body, headers=bearer())
        assert response.status_code == 202
    assert api.registrations == []
    assert store.requests == []
