"""The fixed read capabilities: one literal `GET /v1/capabilities/<route>` per read tool.

No bearer; public content only. The table below is the whole surface: a path outside it is 404 and
no route takes a body, a URL, a file or a path to forward. Each route's query parameters are the
tool's own arguments (its generated input schema) and `page`; an unknown or repeated parameter is
refused before any read. Errors are `Problem` codes: 404 `not_found`, 422 `invalid_arguments`,
429 `rate_limited` (with `Retry-After`), 503 `busy` or `unavailable`.
"""

from __future__ import annotations

import re
from collections.abc import Awaitable, Callable
from typing import Any, Final

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from llm_agent import READ_CAPABILITIES, TOOL_SPECS, ToolName, ToolPage

from ai_service.routes import problem, services
from ai_service.runtime.capabilities import (
    Busy,
    InvalidArguments,
    NotAvailable,
    NotFound,
    RateLimited,
    Unavailable,
)
from ai_service.schemas import MAX_CAPABILITY_PAGE, CapabilityPage, CapabilityRecord, Problem

#: Every capability route, by the read tool it serves.
ROUTES: Final[dict[ToolName, str]] = {
    "get_profile": "profile",
    "list_experiences": "experiences",
    "list_projects": "projects",
    "get_project": "project",
    "list_services": "services",
    "list_explorations": "explorations",
    "list_education": "education",
    "list_current_focus": "current-focus",
    "get_roadmap": "roadmap",
    "get_roadmap_area": "roadmap-area",
    "get_learning_diary": "learning-diary",
    "get_learning_statistics": "learning-statistics",
    "list_books": "books",
    "list_events": "events",
}
if set(ROUTES) != set(READ_CAPABILITIES):
    raise RuntimeError("every read capability needs exactly one route")

_PAGE: Final = re.compile(r"^[1-9][0-9]{0,2}$")
_SPECS: Final[dict[str, dict[str, Any]]] = {spec["name"]: spec for spec in TOOL_SPECS}

router = APIRouter()


def _parameters(name: ToolName) -> list[dict[str, Any]]:
    schema = _SPECS[name]["input_schema"]
    required = set(schema.get("required", []))
    page = {
        "name": "page",
        "in": "query",
        "required": False,
        "schema": {"type": "integer", "minimum": 1, "maximum": MAX_CAPABILITY_PAGE, "default": 1},
        "description": "The page to read; `pageCount` in the answer says how many there are.",
    }
    return [
        {
            "name": argument,
            "in": "query",
            "required": argument in required,
            "schema": {key: value for key, value in spec.items() if key != "description"},
            "description": spec["description"],
        }
        for argument, spec in schema["properties"].items()
    ] + [page]


def _body(page: ToolPage) -> CapabilityPage:
    return CapabilityPage(
        capability=page.capability,
        page=page.page,
        page_count=page.page_count,
        records=[
            CapabilityRecord(
                kind=record.kind,
                id=record.record_id,
                title=record.title,
                href=record.href,
                data=record.data,
            )
            for record in page.records
        ],
    )


def _route(name: ToolName) -> Callable[[Request], Awaitable[CapabilityPage | JSONResponse]]:
    async def capability(request: Request) -> CapabilityPage | JSONResponse:
        items = request.query_params.multi_items()
        query = dict(items)
        page = query.pop("page", "1")
        if (
            len(items) != len({key for key, _ in items})
            or not _PAGE.match(page)
            or int(page) > MAX_CAPABILITY_PAGE
        ):
            return problem(422, "invalid_arguments")
        try:
            return _body(await services(request).capabilities.read(name, query, int(page)))
        except (NotAvailable, NotFound):
            return problem(404, "not_found")
        except InvalidArguments:
            return problem(422, "invalid_arguments")
        except RateLimited as limited:
            response = problem(429, "rate_limited")
            response.headers["retry-after"] = str(limited.retry_after_s)
            return response
        except Busy:
            return problem(503, "busy")
        except Unavailable:
            return problem(503, "unavailable")

    capability.__name__ = name
    return capability


for _name, _segment in ROUTES.items():
    router.add_api_route(
        f"/v1/capabilities/{_segment}",
        _route(_name),
        methods=["GET"],
        name=_name,
        summary=_SPECS[_name]["description"],
        response_model=CapabilityPage,
        responses={
            404: {"model": Problem, "description": "The named record is not published"},
            422: {"model": Problem, "description": "Unknown or invalid arguments or page"},
            429: {"model": Problem, "description": "Too many reads; retry after `Retry-After`"},
            503: {"model": Problem, "description": "Busy, or the content is unavailable"},
        },
        openapi_extra={"parameters": _parameters(_name)},
    )
