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


# --- Learning reads -------------------------------------------------------------------------

UUID = "00000000-0000-4000-8000-000000000201"


def topic(name: str) -> dict[str, Any]:
    return {"id": UUID, "slug": name.lower(), "name": name, "position": 0, **STAMPS}


def progress(completed: int, total: int, status: str, minutes: int) -> dict[str, Any]:
    return {
        "completed": completed,
        "total": total,
        "status": status,
        "completedAt": None,
        "lastUpdatedAt": "2026-03-10T09:00:00.000Z",
        "estimatedMinutes": minutes,
    }


FOCUS_JSON: dict[str, Any] = {
    "id": UUID,
    "slug": "learning-agent-guardrails",
    "title": "Learning how tool-using agents stay safe",
    "description": "Studying guardrails.",
    "link": "https://focus.example.test/",
    "position": 0,
    "project": {
        "slug": "evaluation-harness",
        "name": "Evaluation harness",
        "experience": "brindle-labs-ai-engineer",
    },
    "topics": [topic("Agents")],
    **STAMPS,
}

TREE_RESOURCE_JSON: dict[str, Any] = {
    "id": UUID,
    "slug": "agent-loop-walkthrough",
    "name": "Agent loop walkthrough",
    "description": None,
    "type": "link",
    "status": "in-progress",
    "estimatedMinutes": 90,
    "startedAt": "2026-03-01T09:00:00.000Z",
    "finishedAt": None,
    "link": "https://resource.example.test/",
    "position": 0,
    "book": None,
    "topics": [topic("Agents")],
    **STAMPS,
}

TREE_AREA_JSON: dict[str, Any] = {
    "id": UUID,
    "slug": "agent-systems",
    "name": "Agent systems",
    "description": "Tool-using agents.",
    "weight": 3,
    "position": 0,
    **STAMPS,
    "progress": progress(1, 4, "in-progress", 360),
    "modules": [
        {
            "id": UUID,
            "slug": "tool-use-basics",
            "name": "Tool use basics",
            "description": None,
            "position": 0,
            **STAMPS,
            "progress": progress(1, 2, "in-progress", 180),
            "resources": [TREE_RESOURCE_JSON],
        }
    ],
}

ROADMAP_JSON: dict[str, Any] = {
    "summary": {
        "areaCount": 1,
        "moduleCount": 1,
        "resourceCount": 4,
        "completed": 1,
        "total": 4,
        "estimatedMinutes": 360,
        "estimatedHours": 6,
        "lastUpdatedAt": "2026-03-10T09:00:00.000Z",
    },
    "areas": [TREE_AREA_JSON],
}

DIARY_EVENT_JSON: dict[str, Any] = {
    "slug": "port-wren-agents-conference",
    "name": "Port Wren Agents Conference",
    "kind": "conference",
    "startsOn": "2026-02-19",
    "endsOn": "2026-02-20",
    "link": "https://event.example.test/",
}

DIARY_JSON: dict[str, Any] = {
    "days": [
        {
            "date": "2026-03-10",
            "notes": "Traced an agent loop.",
            "entries": [
                {
                    "id": UUID,
                    "date": "2026-03-10",
                    "resource": {
                        "slug": "agent-loop-walkthrough",
                        "name": "Agent loop walkthrough",
                        "type": "link",
                        "link": "https://resource.example.test/",
                        "module": "tool-use-basics",
                        "area": "agent-systems",
                    },
                    "event": None,
                    "startedAt": "2026-03-10T08:00:00.000Z",
                    "endedAt": "2026-03-10T09:30:00.000Z",
                    "durationSeconds": 5400,
                }
            ],
            "events": [],
            "totalSeconds": 5400,
        },
        {
            "date": "2026-02-19",
            "notes": None,
            "entries": [
                {
                    "id": UUID,
                    "date": "2026-02-19",
                    "resource": None,
                    "event": DIARY_EVENT_JSON,
                    "startedAt": "2026-02-19T08:00:00.000Z",
                    "endedAt": "2026-02-19T13:30:00.000Z",
                    "durationSeconds": 19800,
                }
            ],
            "events": [DIARY_EVENT_JSON],
            "totalSeconds": 19800,
        },
    ]
}


def seconds(total: int, resource: int, book: int, event: int) -> dict[str, int]:
    return {
        "totalSeconds": total,
        "resourceSeconds": resource,
        "bookSeconds": book,
        "eventSeconds": event,
    }


STATISTICS_JSON: dict[str, Any] = {
    "totals": {**seconds(25200, 5400, 0, 19800), "activeDays": 2},
    "days": [{"date": "2026-03-10", **seconds(5400, 5400, 0, 0)}],
    "weeks": [{"startsOn": "2026-03-09", **seconds(5400, 5400, 0, 0)}],
    "months": [{"month": "2026-03", **seconds(5400, 5400, 0, 0)}],
    "areas": [
        {
            "slug": "agent-systems",
            "name": "Agent systems",
            "totalSeconds": 5400,
            "resourceSeconds": 5400,
            "bookSeconds": 0,
            "modules": [
                {
                    "slug": "tool-use-basics",
                    "name": "Tool use basics",
                    "totalSeconds": 5400,
                    "resourceSeconds": 5400,
                    "bookSeconds": 0,
                }
            ],
        }
    ],
    "resources": [
        {
            "slug": "handbook-reading",
            "name": "Handbook reading",
            "type": "book",
            "category": "book",
            "module": {"slug": "retrieval-evaluation", "name": "Retrieval evaluation"},
            "area": {"slug": "retrieval-engineering", "name": "Retrieval engineering"},
            "book": {
                "slug": "search-evaluation-handbook",
                "title": "A Fictional Handbook of Search Evaluation",
            },
            "totalSeconds": 9000,
        }
    ],
    "events": [
        {
            "slug": "port-wren-agents-conference",
            "name": "Port Wren Agents Conference",
            "kind": "conference",
            "startsOn": "2026-02-19",
            "endsOn": "2026-02-20",
            "totalSeconds": 19800,
        }
    ],
}

BOOK_JSON: dict[str, Any] = {
    "id": UUID,
    "slug": "search-evaluation-handbook",
    "title": "A Fictional Handbook of Search Evaluation",
    "author": "Mara Placeholder",
    "description": None,
    "pages": 312,
    "year": 2025,
    "isbn": "9780000000000",
    "priority": 1,
    "startedOn": "2026-02-02",
    "endedOn": None,
    "summary": None,
    "coverId": None,
    "cover": None,
    "status": "reading",
    "resource": {
        "slug": "handbook-reading",
        "name": "Handbook reading",
        "module": "retrieval-evaluation",
        "area": "retrieval-engineering",
    },
    "readingSeconds": 9000,
    **STAMPS,
}

EVENT_JSON: dict[str, Any] = {
    "id": UUID,
    "slug": "port-wren-agents-conference",
    "name": "Port Wren Agents Conference",
    "kind": "conference",
    "organizer": "Port Wren AI Guild",
    "startsOn": "2026-02-19",
    "endsOn": "2026-02-20",
    "place": "Port Wren",
    "online": False,
    "link": "https://event.example.test/",
    "takeaways": "Talks on agent evaluation.",
    "topics": [topic("Agents")],
    "attendanceSeconds": 19800,
    **STAMPS,
}

LEARNING_ROUTES = {
    "/v1/current-focus": (200, [FOCUS_JSON]),
    "/v1/roadmap": (200, ROADMAP_JSON),
    "/v1/roadmap/tree/agent-systems": (200, {"area": TREE_AREA_JSON}),
    "/v1/roadmap/diary": (200, DIARY_JSON),
    "/v1/roadmap/statistics": (200, STATISTICS_JSON),
    "/v1/roadmap/books": (200, [BOOK_JSON]),
    "/v1/roadmap/events": (200, [EVENT_JSON]),
}


async def test_the_learning_reads_map_the_public_records_and_send_no_credentials() -> None:
    seen: list[httpx2.Request] = []
    async with ApiContentReader(BASE_URL, transport=routes(seen, **LEARNING_ROUTES)) as reader:
        focus = await reader.read_current_focus()
        roadmap = await reader.read_roadmap()
        area = await reader.read_roadmap_area("agent-systems")
        diary = await reader.read_diary()
        statistics = await reader.read_statistics()
        books = await reader.read_books()
        events = await reader.read_events()
    assert focus[0].project is not None
    assert (focus[0].slug, focus[0].project.experience, focus[0].topics) == (
        "learning-agent-guardrails",
        "brindle-labs-ai-engineer",
        ["Agents"],
    )
    assert roadmap.summary.estimated_minutes == 360
    assert roadmap.areas[0] == area
    assert (area.progress.completed, area.progress.total, area.progress.status) == (
        1,
        4,
        "in-progress",
    )
    resource = area.modules[0].resources[0]
    assert (resource.type, resource.status, resource.topics) == ("link", "in-progress", ["Agents"])
    assert [day.date.isoformat() for day in diary] == ["2026-03-10", "2026-02-19"]
    session = diary[0].sessions[0]
    assert session.resource is not None
    assert (session.resource.module, session.event, session.duration_seconds) == (
        "tool-use-basics",
        None,
        5400,
    )
    assert diary[1].sessions[0].event == diary[1].events[0]
    assert statistics.totals.active_days == 2
    assert statistics.months[0].month == "2026-03"
    assert statistics.resources[0].book == "A Fictional Handbook of Search Evaluation"
    assert statistics.resources[0].module.name == "Retrieval evaluation"
    assert statistics.events[0].total_seconds == 19800
    assert books[0].status == "reading"
    assert books[0].resource is not None
    assert (books[0].resource.slug, books[0].reading_seconds) == ("handbook-reading", 9000)
    assert (events[0].kind, events[0].topics, events[0].attendance_seconds) == (
        "conference",
        ["Agents"],
        19800,
    )
    assert [r.url.path for r in seen] == list(LEARNING_ROUTES)
    assert all(r.method == "GET" for r in seen)
    for request in seen:
        headers = {key.lower() for key in request.headers}
        assert "authorization" not in headers
        assert "x-api-key" not in headers


async def test_no_learning_read_model_carries_an_outside_url_or_private_detail() -> None:
    seen: list[httpx2.Request] = []
    async with ApiContentReader(BASE_URL, transport=routes(seen, **LEARNING_ROUTES)) as reader:
        dumped = json.dumps(
            [
                *(f.model_dump(mode="json") for f in await reader.read_current_focus()),
                (await reader.read_roadmap()).model_dump(mode="json"),
                *(d.model_dump(mode="json") for d in await reader.read_diary()),
                (await reader.read_statistics()).model_dump(mode="json"),
                *(b.model_dump(mode="json") for b in await reader.read_books()),
                *(e.model_dump(mode="json") for e in await reader.read_events()),
            ]
        )
    assert "example.test" not in dumped
    assert UUID not in dumped
    assert "9780000000000" not in dumped
    assert "2026-03-10T08:00" not in dumped


async def test_a_missing_area_is_not_found_and_a_bad_area_slug_is_never_requested() -> None:
    seen: list[httpx2.Request] = []
    async with ApiContentReader(BASE_URL, transport=routes(seen, **LEARNING_ROUTES)) as reader:
        with pytest.raises(ContentNotFoundError):
            await reader.read_roadmap_area("no-such-area")
        for slug in ("../person", "UPPER", "a" * 101, "", "a/b", "a?b"):
            with pytest.raises(ValueError, match="slug"):
                await reader.read_roadmap_area(slug)
    assert [r.url.path for r in seen] == ["/v1/roadmap/tree/no-such-area"]


@pytest.mark.parametrize(
    ("path", "read", "body"),
    [
        ("/v1/current-focus", "read_current_focus", [{**FOCUS_JSON, "slug": "Not A Slug"}]),
        ("/v1/roadmap", "read_roadmap", {"summary": ROADMAP_JSON["summary"]}),
        (
            "/v1/roadmap",
            "read_roadmap",
            {
                **ROADMAP_JSON,
                "areas": [{**TREE_AREA_JSON, "progress": progress(1, 4, "halfway", 360)}],
            },
        ),
        ("/v1/roadmap/diary", "read_diary", {"days": [{"date": "not a date"}]}),
        ("/v1/roadmap/statistics", "read_statistics", {"totals": {}}),
        ("/v1/roadmap/books", "read_books", [{**BOOK_JSON, "status": "abandoned"}]),
        ("/v1/roadmap/events", "read_events", [{**EVENT_JSON, "kind": "party"}]),
        ("/v1/roadmap/events", "read_events", {"unexpected": True}),
    ],
)
async def test_a_malformed_learning_read_is_unavailable(path: str, read: str, body: object) -> None:
    seen: list[httpx2.Request] = []
    transport = routes(seen, **{**LEARNING_ROUTES, path: (200, body)})
    async with ApiContentReader(BASE_URL, transport=transport) as reader:
        with pytest.raises(ContentUnavailableError):
            await getattr(reader, read)()


async def test_a_failed_learning_read_is_unavailable() -> None:
    seen: list[httpx2.Request] = []
    failing = {
        path: (500, {"error": {"code": "internal_error", "message": "Failed."}})
        for path in LEARNING_ROUTES
    }
    async with ApiContentReader(BASE_URL, transport=routes(seen, **failing)) as reader:
        for read in (
            reader.read_current_focus,
            reader.read_roadmap,
            reader.read_diary,
            reader.read_statistics,
            reader.read_books,
            reader.read_events,
        ):
            with pytest.raises(ContentUnavailableError):
                await read()
        with pytest.raises(ContentUnavailableError) as raised:
            await reader.read_roadmap_area("agent-systems")
        assert not isinstance(raised.value, ContentNotFoundError)
