"""The bounded public read capabilities. No bearer; public content only."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from ai_service.routes import problem, services
from ai_service.runtime.capabilities import Busy, Unavailable
from ai_service.schemas import Problem

router = APIRouter()


@router.get(
    "/v1/capabilities/profile",
    response_model=None,
    responses={
        200: {
            "description": "The public profile view (no identifier, e-mail or links)",
            "content": {"application/json": {"schema": {"type": "object"}}},
        },
        503: {"model": Problem, "description": "Busy or the content is unavailable"},
    },
)
async def profile(request: Request) -> dict[str, Any] | JSONResponse:
    """The published profile, as the agent's `get_profile` tool projects it."""
    try:
        return await services(request).profile.read()
    except Busy:
        return problem(503, "busy")
    except Unavailable:
        return problem(503, "unavailable")
