"""`POST /internal/v1/generations`: the API's dispatch of one admitted question.

The bearer (`AI_SERVICE_TOKEN`) is checked in constant time before the body is read, so an
unauthenticated caller learns nothing about the body's shape. A model or pricing version other
than this agent's is refused before admission. An admitted operation answers 202 at once and
runs on, independent of this request.
"""

from __future__ import annotations

import hmac

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from llm_agent import versions
from pydantic import ValidationError

from ai_service.routes import problem, services
from ai_service.schemas import Accepted, GenerationRequest, Problem

PATH = "/internal/v1/generations"
#: The largest body the route reads; the contract's bounds stay well below it.
MAX_BODY_BYTES = 512 * 1024

router = APIRouter()


@router.post(
    PATH,
    status_code=202,
    response_model=Accepted,
    responses={
        401: {"model": Problem, "description": "No valid bearer"},
        422: {"model": Problem, "description": "An invalid body or another model version"},
        503: {"model": Problem, "description": "Busy: no slot freed in time, or shutting down"},
    },
    openapi_extra={
        "security": [{"bearer": []}],
        "requestBody": {
            "required": True,
            "content": {
                "application/json": {"schema": {"$ref": "#/components/schemas/GenerationRequest"}}
            },
        },
    },
)
async def generate(request: Request) -> Accepted | JSONResponse:
    """Admits one generation and answers before it runs."""
    service = services(request)
    if not _authorized(request, service.settings.token.get_secret_value()):
        return problem(401, "unauthorized")
    body = await request.body()
    if len(body) > MAX_BODY_BYTES:
        return JSONResponse(status_code=422, content={"detail": "the body is too large"})
    try:
        generation = GenerationRequest.model_validate_json(body)
    except ValidationError as error:
        detail = [{"loc": item["loc"], "type": item["type"]} for item in error.errors()]
        return JSONResponse(status_code=422, content={"detail": detail})
    current = versions()
    if (generation.model, generation.pricing_version) != (current.main_model, current.pricing):
        return problem(422, "version_mismatch")
    if not await service.generations.submit(generation):
        return problem(503, "busy")
    return Accepted()


def _authorized(request: Request, token: str) -> bool:
    scheme, _, presented = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not presented:
        return False
    return hmac.compare_digest(presented.encode(), token.encode())
