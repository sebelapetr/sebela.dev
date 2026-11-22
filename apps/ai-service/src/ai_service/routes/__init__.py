"""The HTTP routes. Each router reads the running service from `app.state` through `services`.

The routers are built without settings so the OpenAPI document can be produced without an
environment; `ai_service.app` composes them and attaches the `Services` its lifespan starts.
"""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import Request
from fastapi.responses import JSONResponse

from ai_service.config import Settings
from ai_service.runtime.capabilities import ProfileCapability
from ai_service.runtime.execution import Generations
from ai_service.schemas import Problem


@dataclass(frozen=True)
class Services:
    settings: Settings
    generations: Generations
    profile: ProfileCapability


def services(request: Request) -> Services:
    service: Services = request.app.state.services
    return service


def problem(status: int, code: str) -> JSONResponse:
    body = Problem.model_validate({"code": code}).model_dump(mode="json")
    return JSONResponse(status_code=status, content=body)
