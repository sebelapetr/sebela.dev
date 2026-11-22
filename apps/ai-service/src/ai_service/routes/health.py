"""Liveness and readiness. Neither calls a model or the API."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ai_service.routes import services

router = APIRouter()


class Health(BaseModel):
    status: Literal["ok"] = "ok"


class Ready(BaseModel):
    status: Literal["ready", "stopping"] = "ready"


@router.get("/health", response_model=Health)
async def health() -> Health:
    """The process answers."""
    return Health()


@router.get(
    "/ready", response_model=Ready, responses={503: {"model": Ready, "description": "Stopping"}}
)
async def ready(request: Request) -> Ready | JSONResponse:
    """The settings are loaded and the service admits generations (it is not shutting down)."""
    if not services(request).generations.accepting:
        return JSONResponse(status_code=503, content={"status": "stopping"})
    return Ready()
