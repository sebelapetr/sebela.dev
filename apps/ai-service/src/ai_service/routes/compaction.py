"""`POST /internal/v1/compactions`: the API's dispatch of one compaction of a working context.

The same checks in the same order as a generation (`routes/generation.py`): the bearer
(`AI_SERVICE_TOKEN`, constant time, before the body is read), the body cap, strict validation, the
model, effort and pricing versions against this agent's, then admission into the same slots. An
admitted compaction answers 202 at once and runs on; the API stops it through the generation's
cancel route, which takes any operation identifier.
"""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from llm_agent import versions
from pydantic import ValidationError

from ai_service.routes import MAX_BODY_BYTES, authorized, problem, services
from ai_service.schemas import Accepted, CompactionRequest, Problem

PATH = "/internal/v1/compactions"

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
                "application/json": {"schema": {"$ref": "#/components/schemas/CompactionRequest"}}
            },
        },
    },
)
async def compact(request: Request) -> Accepted | JSONResponse:
    """Admits one compaction and answers before it runs."""
    service = services(request)
    if not authorized(request, service.settings.token.get_secret_value()):
        return problem(401, "unauthorized")
    body = await request.body()
    if len(body) > MAX_BODY_BYTES:
        return JSONResponse(status_code=422, content={"detail": "the body is too large"})
    try:
        compaction = CompactionRequest.model_validate_json(body)
    except ValidationError as error:
        detail = [{"loc": item["loc"], "type": item["type"]} for item in error.errors()]
        return JSONResponse(status_code=422, content={"detail": detail})
    current = versions()
    terms = (compaction.model, compaction.effort, compaction.pricing_version)
    if terms != (current.main_model, current.main_effort, current.pricing):
        return problem(422, "version_mismatch")
    if not await service.generations.submit(compaction):
        return problem(503, "busy")
    return Accepted()
