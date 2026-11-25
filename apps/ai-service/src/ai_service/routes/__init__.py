"""The HTTP routes. Each router reads the running service from `app.state` through `services`.

The routers are built without settings so the OpenAPI document can be produced without an
environment; `ai_service.app` composes them and attaches the `Services` its lifespan starts.
"""

from __future__ import annotations

import hmac
from dataclasses import dataclass

from fastapi import Request
from fastapi.responses import JSONResponse

from ai_service.config import Settings
from ai_service.runtime.capabilities import ReadCapabilities
from ai_service.runtime.execution import Generations
from ai_service.schemas import Problem

#: The largest dispatch body a route reads; the contract's bounds stay well below it.
MAX_BODY_BYTES = 512 * 1024


@dataclass(frozen=True)
class Services:
    settings: Settings
    generations: Generations
    capabilities: ReadCapabilities


def services(request: Request) -> Services:
    service: Services = request.app.state.services
    return service


def problem(status: int, code: str) -> JSONResponse:
    body = Problem.model_validate({"code": code}).model_dump(mode="json")
    return JSONResponse(status_code=status, content=body)


def authorized(request: Request, token: str) -> bool:
    """Whether the request presents `token` as its bearer, compared in constant time."""
    scheme, _, presented = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not presented:
        return False
    return hmac.compare_digest(presented.encode(), token.encode())
