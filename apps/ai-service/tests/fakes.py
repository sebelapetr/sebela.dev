"""Fakes for the service's deterministic tests: a fictional API (public reads and control routes).

No test calls a provider or a real API. The fake API answers the public person and technology
reads and the two control routes over an httpx2 `MockTransport`; it records every claim and every
reported result. It is shared between two service instances to simulate a restart. Its bodies have
the API document's shapes (`ChatGrantClaimed`, `ChatOperation`, `ErrorResponse`).
"""

from __future__ import annotations

import asyncio
import datetime
import json
import uuid
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any

import httpx2
from fastapi import FastAPI
from llm_agent import ModelFactory

from ai_service.app import create_app
from ai_service.config import Settings

#: The fictional service settings: example URLs only, no real host or port is ever reached.
TOKEN = "t" * 40
CONTROL_TOKEN = "c" * 40
API_URL = "http://api.example.test"

ENV: dict[str, str] = {
    "AI_SERVICE_HOST": "service.example.test",
    "LLM_AGENT_PORT": "1",
    "AI_SERVICE_API_URL": API_URL,
    "AI_SERVICE_TOKEN": TOKEN,
    "AI_SERVICE_CONTROL_TOKEN": CONTROL_TOKEN,
}

PERSON_ID = "00000000-0000-4000-8000-000000000001"

#: The fictional person the public API returns, in the API's JSON shape.
PERSON: dict[str, Any] = {
    "id": PERSON_ID,
    "name": "Ilsa Marrow",
    "headline": "Fictional AI engineer for the AI service tests",
    "shortBio": "Ilsa Marrow is a fictional engineer who builds evaluated assistants.",
    "longBio": None,
    "location": "Port Wren",
    "email": "ilsa@marrow.example.test",
    "links": [{"label": "Website", "url": "https://marrow.example.test/"}],
    "availability": None,
    "careerStartedOn": "2015-09-01",
    "servicesIntro": None,
    "collaborationSteps": [],
    "servicesNote": None,
    "photoId": None,
    "cvPdfId": None,
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-01T00:00:00.000Z",
}

#: The fictional technology catalogue the public API returns, in the API's JSON shape.
TECHNOLOGIES: list[dict[str, Any]] = [
    {
        "id": "00000000-0000-4000-8000-000000000061",
        "slug": "python",
        "name": "Python",
        "tier": "primary",
        "group": "core",
        "logoKey": "python",
        "position": 0,
        "createdAt": "2026-01-01T00:00:00.000Z",
        "updatedAt": "2026-01-01T00:00:00.000Z",
    },
    {
        "id": "00000000-0000-4000-8000-000000000062",
        "slug": "bash",
        "name": "Bash",
        "tier": "secondary",
        "group": None,
        "logoKey": None,
        "position": 0,
        "createdAt": "2026-01-01T00:00:00.000Z",
        "updatedAt": "2026-01-01T00:00:00.000Z",
    },
]


def error(code: str) -> dict[str, Any]:
    """The API's common error body (`ErrorResponse`)."""
    return {"error": {"code": code, "message": "A fictional failure."}}


def settings(**overrides: str) -> Settings:
    return Settings.from_env({**ENV, **overrides})


@dataclass
class FakeApi:
    """The fictional API: one-use grants, idempotent results and scripted control failures."""

    #: Grants the API issued, by operation ID.
    grants: dict[str, str] = field(default_factory=dict)
    claimed: set[str] = field(default_factory=set)
    claims: list[dict[str, Any]] = field(default_factory=list)
    #: Every result request, accepted or not, in arrival order.
    report_attempts: list[dict[str, Any]] = field(default_factory=list)
    #: The route of every result request, in arrival order.
    report_paths: list[str] = field(default_factory=list)
    #: The first accepted result per operation (the stored answer).
    stored: dict[str, dict[str, Any]] = field(default_factory=dict)
    #: Status codes the result route returns before it accepts, in order.
    report_failures: list[int] = field(default_factory=list)
    #: The deadline the claim returns; None returns the request's own deadline.
    claim_deadline: str | None = None
    claim_allowance: float = 0.02
    #: How long the claim takes; `claim_started` is set when one arrives.
    claim_delay_s: float = 0.0
    claim_started: asyncio.Event = field(default_factory=asyncio.Event)
    #: The bound terms the claim returns; the defaults are this agent's and the request's.
    claim_model: str = "claude-haiku-5-5"
    claim_effort: str | None = "medium"
    claim_pricing_version: str = "anthropic-2026-11-19"
    claim_context_revision: int = 1
    #: The operation kind the claim returns; None returns the kind the operation was issued as.
    claim_kind: str | None = None
    #: The kind each issued operation was dispatched as (`answer` or `compaction`).
    kinds: dict[str, str] = field(default_factory=dict)
    person_status: int = 200
    person_delay_s: float = 0.0
    person_reads: int = 0
    #: Every public read the service made, by path.
    public_reads: list[str] = field(default_factory=list)
    reported: asyncio.Event = field(default_factory=asyncio.Event)
    deadlines: dict[str, str] = field(default_factory=dict)
    #: Every telemetry registration, as (operation ID, body), in arrival order.
    registrations: list[tuple[str, dict[str, Any]]] = field(default_factory=list)
    #: What a registration answers: `allowed`, `refused` or an error status.
    telemetry_export: str | int = "allowed"

    def issue(self, deadline_s: float = 30.0) -> dict[str, Any]:
        """A fresh generation request body with its own operation and grant."""
        operation = str(uuid.uuid4())
        grant = f"grant-{uuid.uuid4()}"
        self.grants[operation] = grant
        deadline = datetime.datetime.now(datetime.UTC) + datetime.timedelta(seconds=deadline_s)
        deadline_at = deadline.isoformat().replace("+00:00", "Z")
        self.deadlines[operation] = deadline_at
        self.kinds[operation] = "answer"
        return {
            "operationId": operation,
            "grant": grant,
            "question": "Who is Ilsa Marrow?",
            "history": [],
            "today": "2026-11-22",
            "deadlineAt": deadline_at,
            "contextRevision": 1,
            "model": "claude-haiku-5-5",
            "effort": "medium",
            "pricingVersion": "anthropic-2026-11-19",
            "allowanceUsd": 0.02,
        }

    def issue_compaction(
        self,
        exchanges: int = 4,
        *,
        summary: dict[str, Any] | None = None,
        deadline_s: float = 30.0,
    ) -> dict[str, Any]:
        """A fresh compaction request body over `exchanges` fictional exchanges, oldest first."""
        body = self.issue(deadline_s)
        operation = body["operationId"]
        self.kinds[operation] = "compaction"
        for key in ("question", "history", "today"):
            del body[key]
        return {**body, "summary": summary, "exchanges": exchange_bodies(exchanges)}

    def transport(self) -> httpx2.MockTransport:
        return httpx2.MockTransport(self._handle)

    async def _handle(self, request: httpx2.Request) -> httpx2.Response:
        path = request.url.path
        if request.method == "GET":
            self.public_reads.append(path)
        if path == "/v1/person" and request.method == "GET":
            self.person_reads += 1
            if self.person_delay_s:
                await asyncio.sleep(self.person_delay_s)
            if self.person_status != 200:
                return httpx2.Response(self.person_status, json=error("unavailable"))
            return httpx2.Response(200, json=PERSON)
        if path == "/v1/technologies" and request.method == "GET":
            return httpx2.Response(200, json=TECHNOLOGIES)
        if request.headers.get("authorization") != f"Bearer {CONTROL_TOKEN}":
            return httpx2.Response(401, json=error("unauthorized"))
        body = json.loads(request.content)
        if path == "/v1/internal/chat/grants/claim" and request.method == "POST":
            self.claim_started.set()
            if self.claim_delay_s:
                await asyncio.sleep(self.claim_delay_s)
            return self._claim(body)
        prefix, _, rest = path.partition("/v1/internal/chat/operations/")
        if not prefix and rest.endswith("/telemetry") and request.method == "POST":
            return self._telemetry(rest.removesuffix("/telemetry"), body)
        if not prefix and request.method == "POST":
            self.report_paths.append(path)
        if not prefix and rest.endswith("/result") and request.method == "POST":
            return self._result(rest.removesuffix("/result"), body)
        if not prefix and rest.endswith("/compaction") and request.method == "POST":
            return self._result(rest.removesuffix("/compaction"), body)
        return httpx2.Response(404, json=error("not_found"))

    def _claim(self, body: dict[str, Any]) -> httpx2.Response:
        self.claims.append(body)
        operation = body["operationId"]
        if self.grants.get(operation) != body["grant"]:
            return httpx2.Response(403, json=error("forbidden"))
        if operation in self.claimed:
            return httpx2.Response(409, json=error("conflict"))
        self.claimed.add(operation)
        return httpx2.Response(
            200,
            json={
                "claimed": True,
                "deadlineAt": self.claim_deadline or self.deadlines[operation],
                "allowanceUsd": self.claim_allowance,
                "model": self.claim_model,
                "effort": self.claim_effort,
                "pricingVersion": self.claim_pricing_version,
                "contextRevision": self.claim_context_revision,
                "kind": self.claim_kind or self.kinds.get(operation, "answer"),
            },
        )

    def _result(self, operation: str, body: dict[str, Any]) -> httpx2.Response:
        self.report_attempts.append(body)
        if self.report_failures:
            status = self.report_failures.pop(0)
            return httpx2.Response(status, json=error("internal_error"))
        if self.grants.get(operation) != body.get("grant"):
            return httpx2.Response(403, json=error("forbidden"))
        self.stored.setdefault(operation, body)
        self.reported.set()
        return httpx2.Response(
            200,
            json={
                "operationId": operation,
                "requestId": str(uuid.uuid4()),
                "status": "completed",
                "deadlineAt": self.deadlines[operation],
                "assistantMessageId": str(uuid.uuid4()),
            },
        )

    def _telemetry(self, operation: str, body: dict[str, Any]) -> httpx2.Response:
        self.registrations.append((operation, body))
        if self.grants.get(operation) != body.get("grant"):
            return httpx2.Response(403, json=error("forbidden"))
        if operation not in self.claimed:
            return httpx2.Response(409, json=error("conflict"))
        if isinstance(self.telemetry_export, int):
            return httpx2.Response(self.telemetry_export, json=error("internal_error"))
        return httpx2.Response(
            200,
            json={
                "traceId": body["traceId"],
                "export": self.telemetry_export,
                "expiresAt": "2026-12-23T00:00:00.000Z",
            },
        )

    async def wait_reported(self, count: int = 1, timeout_s: float = 10.0) -> None:
        async with asyncio.timeout(timeout_s):
            while len(self.stored) < count:
                self.reported.clear()
                if len(self.stored) >= count:
                    return
                await self.reported.wait()


LANGFUSE_URL = "https://langfuse.example.test"
LANGFUSE_PUBLIC = "pk-lf-fictional-0000"
LANGFUSE_SECRET = "sk-lf-fictional-secret-0000"

#: The service settings that turn the trace export on, with fictional keys and host.
LANGFUSE_ENV: dict[str, str] = {
    "AI_SERVICE_LANGFUSE_BASE_URL": LANGFUSE_URL,
    "AI_SERVICE_LANGFUSE_PUBLIC_KEY": LANGFUSE_PUBLIC,
    "AI_SERVICE_LANGFUSE_SECRET_KEY": LANGFUSE_SECRET,
}


@dataclass
class FakeLangfuse:
    """The fictional trace store: it records every outbound request whole, headers and body."""

    requests: list[httpx2.Request] = field(default_factory=list)
    #: Status codes the ingestion answers before it accepts, in order (0 is a transport failure).
    failures: list[int] = field(default_factory=list)
    #: How long each ingestion takes.
    delay_s: float = 0.0
    received: asyncio.Event = field(default_factory=asyncio.Event)

    def transport(self) -> httpx2.MockTransport:
        return httpx2.MockTransport(self._handle)

    @property
    def bodies(self) -> list[dict[str, Any]]:
        return [json.loads(request.content) for request in self.requests]

    async def _handle(self, request: httpx2.Request) -> httpx2.Response:
        self.requests.append(request)
        self.received.set()
        if self.delay_s:
            await asyncio.sleep(self.delay_s)
        if self.failures:
            status = self.failures.pop(0)
            if status == 0:
                raise httpx2.ConnectError("fictional outage", request=request)
            return httpx2.Response(status, json={"message": "fictional failure"})
        return httpx2.Response(200, json={})

    async def wait(self, count: int = 1, timeout_s: float = 10.0) -> None:
        async with asyncio.timeout(timeout_s):
            while len(self.requests) < count:
                self.received.clear()
                await self.received.wait()


def exchange_bodies(count: int) -> list[dict[str, Any]]:
    """`count` fictional answered exchanges in the API's history shape, oldest first."""
    return [
        {
            "question": f"What did Ilsa Marrow build in fictional year {index}?",
            "answer": f"In fictional year {index} Ilsa Marrow built an evaluated assistant.",
            "language": "en",
            "sources": [{"kind": "person", "recordId": PERSON_ID, "title": "Ilsa Marrow"}],
        }
        for index in range(count)
    ]


@asynccontextmanager
async def running(
    api: FakeApi,
    models: ModelFactory | None,
    service: Settings | None = None,
    **create: Any,
) -> AsyncIterator[tuple[FastAPI, httpx2.AsyncClient]]:
    """A started service (its lifespan entered) and a client over ASGI; the exit shuts it down."""
    app = create_app(service or settings(), models=models, transport=api.transport(), **create)
    async with app.router.lifespan_context(app):
        transport = httpx2.ASGITransport(app=app)
        async with httpx2.AsyncClient(
            transport=transport, base_url="http://service.test"
        ) as client:
            yield app, client


def bearer(token: str = TOKEN) -> dict[str, str]:
    return {"authorization": f"Bearer {token}"}


def later(callback: Callable[[], None], seconds: float) -> asyncio.TimerHandle:
    return asyncio.get_running_loop().call_later(seconds, callback)
