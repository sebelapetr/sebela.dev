"""The public-read adapter over the generated content client, with an in-memory transport."""

from __future__ import annotations

import json
from typing import Any

import httpx2
import pytest

from llm_agent import ApiContentReader, ContentNotFoundError, ContentUnavailableError
from tests.unit.fakes import PERSON_ID

BASE_URL = "https://content.example.test"

PERSON_JSON: dict[str, Any] = {
    "id": PERSON_ID,
    "name": "Ilsa Marrow",
    "headline": "Fictional AI engineer",
    "shortBio": "A fictional engineer.",
    "longBio": None,
    "location": "Port Wren",
    "email": "ilsa@marrow.example.test",
    "links": [{"label": "Website", "url": "https://marrow.example.test/"}],
    "availability": None,
    "careerStartedOn": "2015-09-01",
    "servicesIntro": None,
    "collaborationSteps": [{"title": "Call", "description": "A short call."}],
    "servicesNote": None,
    "photoId": None,
    "cvPdfId": None,
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-01T00:00:00.000Z",
}


def transport(status: int, body: object, seen: list[httpx2.Request]) -> httpx2.MockTransport:
    def handle(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        return httpx2.Response(status, content=json.dumps(body).encode())

    return httpx2.MockTransport(handle)


async def test_the_reader_maps_the_public_person_and_sends_no_credentials() -> None:
    seen: list[httpx2.Request] = []
    async with ApiContentReader(BASE_URL, transport=transport(200, PERSON_JSON, seen)) as reader:
        person = await reader.read_person()
    assert person.id == PERSON_ID
    assert person.links[0].url == "https://marrow.example.test/"
    assert person.collaboration_steps[0].title == "Call"
    assert [(r.method, r.url.path) for r in seen] == [("GET", "/v1/person")]
    assert "authorization" not in {key.lower() for key in seen[0].headers}
    assert "x-api-key" not in {key.lower() for key in seen[0].headers}


@pytest.mark.parametrize(
    ("status", "body"),
    [
        (404, {"error": {"code": "not_found", "message": "No person."}}),
        (500, {"error": {"code": "internal", "message": "Failed."}}),
        (200, {"unexpected": True}),
    ],
)
async def test_a_missing_failed_or_malformed_read_is_unavailable(status: int, body: object) -> None:
    seen: list[httpx2.Request] = []
    async with ApiContentReader(BASE_URL, transport=transport(status, body, seen)) as reader:
        with pytest.raises(ContentUnavailableError):
            await reader.read_person()


async def test_a_connection_failure_is_unavailable() -> None:
    def refuse(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError("refused", request=request)

    async with ApiContentReader(BASE_URL, transport=httpx2.MockTransport(refuse)) as reader:
        with pytest.raises(ContentUnavailableError):
            await reader.read_person()


def test_only_http_base_urls_are_accepted() -> None:
    with pytest.raises(ValueError, match="http"):
        ApiContentReader("file:///etc/passwd")


# --- Career reads ---------------------------------------------------------------------------

STAMPS = {"createdAt": "2026-01-01T00:00:00.000Z", "updatedAt": "2026-01-01T00:00:00.000Z"}


def technology(slug: str, name: str) -> dict[str, Any]:
    return {
        "id": "00000000-0000-4000-8000-0000000000a1",
        "slug": slug,
        "name": name,
        "tier": "primary",
        "group": None,
        "logoKey": None,
        "position": 0,
        **STAMPS,
    }


PROJECT_JSON: dict[str, Any] = {
    "id": "00000000-0000-4000-8000-0000000000b1",
    "slug": "support-answer-engine",
    "experience": "brindle-labs-ai-engineer",
    "name": "Support answer engine",
    "summary": "A fictional answer engine.",
    "problem": "Slow answers.",
    "workDone": "Built retrieval.",
    "result": "Faster answers.",
    "startedOn": "2021-06-01",
    "endedOn": "2023-04-30",
    "links": [{"label": "Demo", "url": "https://demo.example.test/"}],
    "selectedForHomepage": True,
    "position": 0,
    "coverId": None,
    "technologies": [technology("python", "Python")],
    "caseStudy": {
        "id": "00000000-0000-4000-8000-0000000000c1",
        "project": "support-answer-engine",
        "role": "Lead engineer",
        "body": "A fictional case study.",
        **STAMPS,
    },
    **STAMPS,
}

EXPERIENCE_JSON: dict[str, Any] = {
    "id": "00000000-0000-4000-8000-0000000000d1",
    "slug": "brindle-labs-ai-engineer",
    "title": "AI engineer",
    "kind": "main_job",
    "startedOn": "2021-03-01",
    "endedOn": None,
    "summary": "Builds fictional assistants.",
    "responsibilities": ["Evaluation"],
    "inCv": True,
    "organization": {
        "id": "00000000-0000-4000-8000-0000000000e1",
        "slug": "brindle-labs",
        "name": "Brindle Labs",
        "website": "https://brindle.example.test/",
        "description": None,
        "logoId": None,
        **STAMPS,
    },
    "technologies": [technology("python", "Python"), technology("pgvector", "pgvector")],
    "projects": [PROJECT_JSON],
    "testimonials": [],
    **STAMPS,
}

EXPLORATION_JSON: dict[str, Any] = {
    "id": "00000000-0000-4000-8000-0000000000f1",
    "slug": "reranking-trial",
    "name": "Reranking trial",
    "summary": "A fictional trial.",
    "status": "tested",
    "concepts": ["reranking"],
    "startedOn": "2024-01-01",
    "endedOn": None,
    "position": 0,
    "technologies": [technology("python", "Python")],
    "topics": [
        {
            "id": "00000000-0000-4000-8000-0000000000f2",
            "slug": "retrieval",
            "name": "Retrieval",
            "position": 0,
            **STAMPS,
        }
    ],
    **STAMPS,
}

SERVICE_JSON: dict[str, Any] = {
    "id": "00000000-0000-4000-8000-000000000101",
    "slug": "evaluation-setup",
    "name": "Evaluation setup",
    "summary": "A fictional service.",
    "audience": "Teams with an assistant.",
    "deliverable": "An eval harness.",
    "position": 0,
    "evidence": [
        {
            "kind": "project",
            "project": {
                "slug": "support-answer-engine",
                "name": "Support answer engine",
                "summary": "A fictional answer engine.",
                "experience": "brindle-labs-ai-engineer",
            },
        },
        {
            "kind": "exploration",
            "exploration": {
                "slug": "reranking-trial",
                "name": "Reranking trial",
                "summary": "A fictional trial.",
                "status": "tested",
            },
        },
        {"kind": "link", "label": "Read more", "path": "/services#faq"},
    ],
    **STAMPS,
}

EDUCATION_JSON: dict[str, Any] = {
    "id": "00000000-0000-4000-8000-000000000111",
    "slug": "retrieval-evaluation-course",
    "kind": "course",
    "title": "Retrieval evaluation",
    "institution": "Example Learning Commons",
    "startedOn": None,
    "endedOn": "2022-11-30",
    "description": None,
    "position": 0,
    **STAMPS,
}


def routes(seen: list[httpx2.Request], **bodies: tuple[int, object]) -> httpx2.MockTransport:
    def handle(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        status, body = bodies.get(
            request.url.path, (404, {"error": {"code": "not_found", "message": "Not found."}})
        )
        return httpx2.Response(status, content=json.dumps(body).encode())

    return httpx2.MockTransport(handle)


CAREER_ROUTES = {
    "/v1/experiences": (200, [EXPERIENCE_JSON]),
    "/v1/projects": (200, [PROJECT_JSON]),
    "/v1/projects/support-answer-engine": (200, PROJECT_JSON),
    "/v1/explorations": (200, [EXPLORATION_JSON]),
    "/v1/services": (200, [SERVICE_JSON]),
    "/v1/education": (200, [EDUCATION_JSON]),
}


async def test_the_career_reads_map_the_public_records_and_send_no_credentials() -> None:
    seen: list[httpx2.Request] = []
    async with ApiContentReader(BASE_URL, transport=routes(seen, **CAREER_ROUTES)) as reader:
        experiences = await reader.read_experiences()
        projects = await reader.read_projects()
        project = await reader.read_project("support-answer-engine")
        explorations = await reader.read_explorations()
        services = await reader.read_services()
        education = await reader.read_education()
    experience = experiences[0]
    assert (experience.slug, experience.organization, experience.ended_on) == (
        "brindle-labs-ai-engineer",
        "Brindle Labs",
        None,
    )
    assert experience.technologies == ["Python", "pgvector"]
    assert [p.slug for p in experience.projects] == ["support-answer-engine"]
    assert projects[0] == project
    assert project.experience == "brindle-labs-ai-engineer"
    assert project.case_study is not None
    assert project.case_study.role == "Lead engineer"
    assert explorations[0].status == "tested"
    assert explorations[0].topics == ["Retrieval"]
    # Link evidence is a free site path, not a record: only record evidence is read.
    assert [(e.kind, e.slug, e.status) for e in services[0].evidence] == [
        ("project", "support-answer-engine", None),
        ("exploration", "reranking-trial", "tested"),
    ]
    assert (education[0].kind, education[0].started_on) == ("course", None)
    assert [r.url.path for r in seen] == list(CAREER_ROUTES)
    assert all(r.method == "GET" for r in seen)
    for request in seen:
        headers = {key.lower() for key in request.headers}
        assert "authorization" not in headers
        assert "x-api-key" not in headers


async def test_no_read_model_carries_an_outside_url() -> None:
    seen: list[httpx2.Request] = []
    async with ApiContentReader(BASE_URL, transport=routes(seen, **CAREER_ROUTES)) as reader:
        dumped = json.dumps(
            [
                *(e.model_dump(mode="json") for e in await reader.read_experiences()),
                (await reader.read_project("support-answer-engine")).model_dump(mode="json"),
            ]
        )
    assert "example.test" not in dumped


async def test_a_missing_project_is_not_found_and_a_bad_slug_is_never_requested() -> None:
    seen: list[httpx2.Request] = []
    async with ApiContentReader(BASE_URL, transport=routes(seen, **CAREER_ROUTES)) as reader:
        with pytest.raises(ContentNotFoundError):
            await reader.read_project("no-such-project")
        for slug in ("../person", "UPPER", "a" * 101, "", "a/b", "a?b"):
            with pytest.raises(ValueError, match="slug"):
                await reader.read_project(slug)
    assert [r.url.path for r in seen] == ["/v1/projects/no-such-project"]


@pytest.mark.parametrize(
    ("path", "body"),
    [
        ("/v1/experiences", [{**EXPERIENCE_JSON, "slug": "Not A Slug"}]),
        ("/v1/experiences", {"unexpected": True}),
        ("/v1/projects", [{**PROJECT_JSON, "experience": "../admin"}]),
        ("/v1/services", [{**SERVICE_JSON, "summary": None}]),
    ],
)
async def test_a_malformed_list_is_unavailable(path: str, body: object) -> None:
    seen: list[httpx2.Request] = []
    transport = routes(seen, **{**CAREER_ROUTES, path: (200, body)})
    read = {
        "/v1/experiences": "read_experiences",
        "/v1/projects": "read_projects",
        "/v1/services": "read_services",
    }[path]
    async with ApiContentReader(BASE_URL, transport=transport) as reader:
        with pytest.raises(ContentUnavailableError):
            await getattr(reader, read)()


async def test_a_failed_career_read_is_unavailable() -> None:
    seen: list[httpx2.Request] = []
    failing = {
        path: (500, {"error": {"code": "internal_error", "message": "Failed."}})
        for path in CAREER_ROUTES
    }
    async with ApiContentReader(BASE_URL, transport=routes(seen, **failing)) as reader:
        for read in (
            reader.read_experiences,
            reader.read_projects,
            reader.read_explorations,
            reader.read_services,
            reader.read_education,
        ):
            with pytest.raises(ContentUnavailableError):
                await read()
        with pytest.raises(ContentUnavailableError) as raised:
            await reader.read_project("support-answer-engine")
        assert not isinstance(raised.value, ContentNotFoundError)
