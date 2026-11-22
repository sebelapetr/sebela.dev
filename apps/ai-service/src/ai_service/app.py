"""The service application (stub)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx2
from fastapi import FastAPI
from llm_agent import ModelFactory

from ai_service.config import Settings


@dataclass(frozen=True)
class CapabilityLimits:
    concurrency: int = 8
    timeout_s: float = 5.0


def create_app(
    settings: Settings,
    *,
    models: ModelFactory | None = None,
    transport: httpx2.AsyncBaseTransport | None = None,
    capability_limits: CapabilityLimits | None = None,
) -> FastAPI:
    raise NotImplementedError(settings, models, transport, capability_limits)


def openapi_document() -> dict[str, Any]:
    raise NotImplementedError
