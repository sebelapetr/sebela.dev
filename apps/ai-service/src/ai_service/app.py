"""The service application: the composition of settings, the agent, the API clients and routes.

`create_app(settings)` builds the FastAPI app; its lifespan opens the public content reader and
the control client, starts the trace exporter when Langfuse is configured, starts admitting
generations and, on exit, shuts down bounded (`Generations.shutdown`, then the exporter). The
model is the fictional one unless the settings choose the paid `anthropic` one, which also brings
the daily ceiling. `openapi_document()` is the service's published interface and needs no
environment.
"""

from __future__ import annotations

import time
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any

import httpx2
from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi
from llm_agent import ApiContentReader, ChatAgent, ModelFactory, anthropic_model_factory

from ai_service.clients.control_api import ControlApi
from ai_service.config import Settings
from ai_service.models.fake import FakeModels
from ai_service.routes import Services, capabilities, compaction, generation, health
from ai_service.runtime.admission import Admission
from ai_service.runtime.capabilities import ReadCapabilities
from ai_service.runtime.ceiling import DailyCeiling
from ai_service.runtime.execution import Generations
from ai_service.runtime.telemetry import TraceExporter
from ai_service.schemas import CompactionRequest, GenerationRequest

TITLE = "Sebela AI service"
#: How long a shutdown lets queued traces go after the operations ended.
_TELEMETRY_SHUTDOWN_S = 5.0
VERSION = "0.0.0"


@dataclass(frozen=True)
class CapabilityLimits:
    """The bounds every read caller shares: parallel reads, one read's time and the read rate."""

    concurrency: int = 8
    timeout_s: float = 5.0
    #: Reads per sliding `window_s`, across every read caller.
    rate: int = 120
    window_s: float = 60.0
    clock: Callable[[], float] = time.monotonic


def create_app(
    settings: Settings,
    *,
    models: ModelFactory | None = None,
    transport: httpx2.AsyncBaseTransport | None = None,
    capability_limits: CapabilityLimits | None = None,
    telemetry_transport: httpx2.AsyncBaseTransport | None = None,
) -> FastAPI:
    """The service for `settings`; `models`, `transport` and `telemetry_transport` replace the
    model, the API and the trace store."""
    factory = models or _models(settings)
    limits = capability_limits or CapabilityLimits()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        async with ApiContentReader(settings.api_url, transport=transport) as content:
            control = ControlApi(
                settings.api_url, settings.control_token.get_secret_value(), transport=transport
            )
            telemetry = None
            if settings.langfuse is not None:
                telemetry = TraceExporter(
                    settings.langfuse,
                    register=control.register_telemetry,
                    transport=telemetry_transport,
                )
                telemetry.start()
            generations = Generations(
                agent=ChatAgent(content=content, models=factory, telemetry=telemetry),
                control=control,
                admission=Admission(settings.max_operations, settings.admission_wait_s),
                ceiling=_ceiling(settings),
                telemetry=telemetry,
            )
            app.state.services = Services(
                settings=settings,
                generations=generations,
                capabilities=ReadCapabilities(
                    content,
                    concurrency=limits.concurrency,
                    timeout_s=limits.timeout_s,
                    rate=limits.rate,
                    window_s=limits.window_s,
                    clock=limits.clock,
                ),
            )
            try:
                yield
            finally:
                await generations.shutdown(settings.shutdown_grace_s)
                if telemetry is not None:
                    await telemetry.shutdown(_TELEMETRY_SHUTDOWN_S)
                await control.aclose()

    app = _app(lifespan)
    return app


def openapi_document() -> dict[str, Any]:
    """The service's OpenAPI document (`apps/ai-service/openapi.json`)."""
    app = _app(None)
    document = get_openapi(title=TITLE, version=VERSION, routes=app.routes)
    schemas: dict[str, Any] = document.setdefault("components", {}).setdefault("schemas", {})
    request = GenerationRequest.model_json_schema(
        by_alias=True, ref_template="#/components/schemas/{model}"
    )
    schemas.update(request.pop("$defs", {}))
    schemas["GenerationRequest"] = request
    compaction_request = CompactionRequest.model_json_schema(
        by_alias=True, ref_template="#/components/schemas/{model}"
    )
    schemas.update(compaction_request.pop("$defs", {}))
    schemas["CompactionRequest"] = compaction_request
    document["components"]["securitySchemes"] = {"bearer": {"type": "http", "scheme": "bearer"}}
    return {
        **document,
        "components": {
            "schemas": dict(sorted(schemas.items())),
            "securitySchemes": document["components"]["securitySchemes"],
        },
    }


def _app(lifespan: Any) -> FastAPI:
    app = FastAPI(
        title=TITLE,
        version=VERSION,
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    for router in (generation.router, compaction.router, capabilities.router, health.router):
        app.include_router(router)
    return app


def _models(settings: Settings) -> ModelFactory:
    if settings.model == "anthropic":
        return anthropic_model_factory()
    return FakeModels(
        settings.fake_scenario,
        calls_file=settings.fake_calls_file,
        gate_file=settings.fake_gate_file,
    )


def _ceiling(settings: Settings) -> DailyCeiling | None:
    if settings.model != "anthropic" or settings.daily_ceiling_usd is None:
        return None
    return DailyCeiling(settings.daily_ceiling_usd)
