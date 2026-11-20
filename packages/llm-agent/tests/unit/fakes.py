"""Scripted fakes for the agent's deterministic tests: models, the content reader and messages.

No test here calls a provider or the content API. A scripted model answers each stage call with
the next step of its stage's script: a message, an exception to raise, or an awaitable that never
finishes (to exercise deadlines and cancellation).
"""

from __future__ import annotations

import asyncio
import datetime
import json
from collections.abc import Sequence
from typing import Any

import anthropic
import httpx2
from langchain_core.messages import AIMessage, BaseMessage
from langsmith.run_helpers import get_tracing_context

from llm_agent import (
    ContentNotFoundError,
    ContentUnavailableError,
    ModelCall,
    PublicBook,
    PublicBookResource,
    PublicCaseStudy,
    PublicCurrentFocus,
    PublicDiaryDay,
    PublicDiaryEvent,
    PublicDiaryResource,
    PublicDiarySession,
    PublicEducation,
    PublicEvent,
    PublicExperience,
    PublicExploration,
    PublicFocusProject,
    PublicLearningStatistics,
    PublicLink,
    PublicPerson,
    PublicProgress,
    PublicProject,
    PublicProjectSummary,
    PublicRoadmap,
    PublicRoadmapArea,
    PublicRoadmapModule,
    PublicRoadmapResource,
    PublicRoadmapSummary,
    PublicService,
    PublicServiceEvidence,
    PublicStep,
)

PERSON_ID = "00000000-0000-4000-8000-000000000001"

PERSON = PublicPerson(
    id=PERSON_ID,
    name="Ilsa Marrow",
    headline="Fictional AI engineer for the LLM agent evals",
    short_bio="Ilsa Marrow is a fictional engineer who builds evaluated assistants.",
    long_bio="Ilsa Marrow does not exist; she focuses on retrieval and evaluation.",
    location="Port Wren",
    email="ilsa@marrow.example.test",
    links=[
        PublicLink(label="Website", url="https://marrow.example.test/"),
        PublicLink(label="Code", url="https://code.example.test/ilsa-marrow"),
    ],
    availability="Open to two days a week of consulting from March 2027.",
    career_started_on=datetime.date(2015, 9, 1),
    services_intro="Ilsa offers fictional reviews of chat assistants.",
    collaboration_steps=[PublicStep(title="Call", description="A short call.")],
    services_note="Fixture note: no prices are published.",
)

CONTACT = {
    "name": "Ilsa Marrow",
    "email": "ilsa@marrow.example.test",
    "links": [
        {"label": "Website", "url": "https://marrow.example.test/"},
        {"label": "Code", "url": "https://code.example.test/ilsa-marrow"},
    ],
}

USAGE = {"input_tokens": 1000, "output_tokens": 200, "total_tokens": 1200}


class Hang:
    """A model step that never returns; the agent must time it out or cancel it."""

    def __init__(self) -> None:
        self.started = asyncio.Event()


Step = BaseMessage | BaseException | Hang


class ScriptedModel:
    def __init__(self, owner: ScriptedModels, call: ModelCall) -> None:
        self.owner = owner
        self.call = call

    async def ainvoke(self, input: Sequence[BaseMessage]) -> BaseMessage:
        self.owner.calls.append((self.call, list(input)))
        self.owner.tracing.append(get_tracing_context()["enabled"])
        script = self.owner.scripts[self.call.stage]
        if not script:
            raise AssertionError(f"unexpected {self.call.stage} call")
        step = script.pop(0)
        if isinstance(step, Hang):
            step.started.set()
            await asyncio.Event().wait()
            raise AssertionError("unreachable")
        if isinstance(step, BaseException):
            raise step
        return step


class ScriptedModels:
    """A model factory whose stage models play back a script per stage."""

    def __init__(self, *, security: Sequence[Step] = (), main: Sequence[Step] = ()) -> None:
        self.scripts: dict[str, list[Step]] = {"security": list(security), "main": list(main)}
        self.calls: list[tuple[ModelCall, list[BaseMessage]]] = []
        #: The LangSmith tracing switch each model call saw (False: explicitly off).
        self.tracing: list[bool | str | None] = []

    def __call__(self, call: ModelCall) -> ScriptedModel:
        return ScriptedModel(self, call)

    def stage_calls(self, stage: str) -> list[tuple[ModelCall, list[BaseMessage]]]:
        return [entry for entry in self.calls if entry[0].stage == stage]


def _uuid(number: int) -> str:
    return f"00000000-0000-4000-8000-{number:012d}"


PROJECTS = [
    PublicProject(
        id=_uuid(11),
        slug="support-answer-engine",
        experience="brindle-labs-ai-engineer",
        name="Support answer engine",
        summary="A fictional answer engine over support articles.",
        problem="Support answers took too long.",
        work_done="Built retrieval over the articles.",
        result="Answers cite their articles.",
        started_on=datetime.date(2021, 6, 1),
        ended_on=datetime.date(2023, 4, 30),
        technologies=["Python", "pgvector", "PostgreSQL"],
        case_study=PublicCaseStudy(role="Lead engineer", body="A fictional case study."),
    ),
    PublicProject(
        id=_uuid(12),
        slug="evaluation-harness",
        experience="brindle-labs-ai-engineer",
        name="Evaluation harness",
        summary="A fictional harness for answer evaluations.",
        problem="Answer quality was not measured.",
        work_done="Built repeatable eval runs.",
        result="Every change is measured.",
        started_on=datetime.date(2023, 5, 1),
        ended_on=None,
        technologies=["Python"],
        case_study=None,
    ),
]

EXPERIENCES = [
    PublicExperience(
        id=_uuid(21),
        slug="brindle-labs-ai-engineer",
        title="AI engineer",
        kind="main_job",
        organization="Brindle Labs",
        started_on=datetime.date(2021, 3, 1),
        ended_on=None,
        summary="Builds fictional evaluated assistants.",
        responsibilities=["Retrieval", "Evaluation"],
        technologies=["Python", "LangGraph", "pgvector", "PostgreSQL"],
        projects=[
            PublicProjectSummary(
                slug=p.slug, name=p.name, started_on=p.started_on, ended_on=p.ended_on
            )
            for p in PROJECTS
        ],
    ),
]

EXPLORATIONS = [
    PublicExploration(
        id=_uuid(31),
        slug="reranking-trial",
        name="Reranking trial",
        summary="A fictional reranking trial.",
        status="tested",
        concepts=["reranking"],
        started_on=datetime.date(2024, 1, 1),
        ended_on=datetime.date(2024, 2, 1),
        technologies=["Python"],
        topics=["Retrieval"],
    ),
    PublicExploration(
        id=_uuid(32),
        slug="conversation-memory-design",
        name="Conversation memory design",
        summary="A fictional design for conversation memory.",
        status="designed",
        concepts=["memory"],
        started_on=datetime.date(2024, 3, 1),
        ended_on=None,
        technologies=[],
        topics=[],
    ),
]

SERVICES = [
    PublicService(
        id=_uuid(41),
        slug="evaluation-setup",
        name="Evaluation setup",
        summary="A fictional evaluation setup for chat assistants.",
        audience="Teams with an assistant.",
        deliverable="A repeatable eval harness.",
        evidence=[
            PublicServiceEvidence(
                kind="project",
                slug="evaluation-harness",
                name="Evaluation harness",
                summary="A fictional harness.",
                status=None,
            ),
            PublicServiceEvidence(
                kind="exploration",
                slug="reranking-trial",
                name="Reranking trial",
                summary="A fictional trial.",
                status="tested",
            ),
        ],
    ),
]

EDUCATION = [
    PublicEducation(
        id=_uuid(51),
        slug="retrieval-evaluation-course",
        kind="course",
        title="Retrieval evaluation",
        institution="Example Learning Commons",
        started_on=None,
        ended_on=datetime.date(2022, 11, 30),
        description=None,
    ),
]


CURRENT_FOCUS = [
    PublicCurrentFocus(
        slug="evaluation-harness-for-other-teams",
        title="Opening the evaluation harness to other teams",
        description="Turning the fictional harness into a shared release gate.",
        project=PublicFocusProject(
            slug="evaluation-harness",
            name="Evaluation harness",
            experience="brindle-labs-ai-engineer",
        ),
        topics=["Evaluation"],
    ),
    PublicCurrentFocus(
        slug="learning-agent-guardrails",
        title="Learning how tool-using agents stay safe",
        description="Studying guardrails for agents on the AI Roadmap.",
        project=None,
        topics=["Agents"],
    ),
]


def _progress(completed: int, total: int, status: str, minutes: int) -> PublicProgress:
    return PublicProgress.model_validate(
        {"completed": completed, "total": total, "status": status, "estimated_minutes": minutes}
    )


def _resource(slug: str, name: str, status: str, *, book: str | None = None) -> Any:
    return PublicRoadmapResource.model_validate(
        {
            "slug": slug,
            "name": name,
            "description": None,
            "type": "book" if book else "link",
            "status": status,
            "estimated_minutes": 90,
            "book": book,
            "topics": ["Agents"],
        }
    )


AGENT_AREA = PublicRoadmapArea(
    slug="agent-systems",
    name="Agent systems",
    description="Tool-using agents and their limits.",
    progress=_progress(1, 4, "in-progress", 360),
    modules=[
        PublicRoadmapModule(
            slug="tool-use-basics",
            name="Tool use basics",
            description="How a model asks for a tool.",
            progress=_progress(1, 2, "in-progress", 180),
            resources=[
                _resource("function-calling-tutorial", "Function calling tutorial", "completed"),
                _resource("agent-loop-walkthrough", "Agent loop walkthrough", "in-progress"),
            ],
        ),
        PublicRoadmapModule(
            slug="agent-guardrails",
            name="Agent guardrails",
            description=None,
            progress=_progress(0, 2, "planned", 180),
            resources=[
                _resource("guardrail-notes", "Guardrail notes", "planned"),
                _resource(
                    "agent-design-notes", "Agent design notes", "planned", book="agent-design-notes"
                ),
            ],
        ),
    ],
)

ROADMAP = PublicRoadmap(
    summary=PublicRoadmapSummary(
        area_count=1,
        module_count=2,
        resource_count=4,
        completed=1,
        total=4,
        estimated_minutes=360,
    ),
    areas=[AGENT_AREA],
)

LOOP = PublicDiaryResource(
    slug="agent-loop-walkthrough",
    name="Agent loop walkthrough",
    type="link",
    module="tool-use-basics",
    area="agent-systems",
)
CONFERENCE = PublicDiaryEvent(
    slug="port-wren-agents-conference",
    name="Port Wren Agents Conference",
    kind="conference",
    starts_on=datetime.date(2026, 2, 19),
    ends_on=datetime.date(2026, 2, 20),
)

DIARY = [
    PublicDiaryDay(
        date=datetime.date(2026, 3, 10),
        notes="Traced an agent loop step by step.",
        sessions=[PublicDiarySession(resource=LOOP, event=None, duration_seconds=5_400)],
        events=[],
        total_seconds=5_400,
    ),
    PublicDiaryDay(
        date=datetime.date(2026, 2, 19),
        notes=None,
        sessions=[PublicDiarySession(resource=None, event=CONFERENCE, duration_seconds=19_800)],
        events=[CONFERENCE],
        total_seconds=19_800,
    ),
]


def _time(total: int, resource: int, book: int, event: int) -> dict[str, int]:
    return {
        "total_seconds": total,
        "resource_seconds": resource,
        "book_seconds": book,
        "event_seconds": event,
    }


STATISTICS = PublicLearningStatistics.model_validate(
    {
        "totals": {**_time(63_600, 27_600, 9_000, 27_000), "active_days": 9},
        "weeks": [{"starts_on": "2026-03-09", **_time(5_400, 5_400, 0, 0)}],
        "months": [
            {"month": "2026-02", **_time(19_800, 0, 0, 19_800)},
            {"month": "2026-03", **_time(24_000, 15_000, 9_000, 0)},
        ],
        "areas": [
            {
                "slug": "agent-systems",
                "name": "Agent systems",
                "total_seconds": 5_400,
                "resource_seconds": 5_400,
                "book_seconds": 0,
                "modules": [
                    {
                        "slug": "tool-use-basics",
                        "name": "Tool use basics",
                        "total_seconds": 5_400,
                        "resource_seconds": 5_400,
                        "book_seconds": 0,
                    }
                ],
            }
        ],
        "resources": [
            {
                "slug": "agent-loop-walkthrough",
                "name": "Agent loop walkthrough",
                "type": "link",
                "category": "resource",
                "module": {"slug": "tool-use-basics", "name": "Tool use basics"},
                "area": {"slug": "agent-systems", "name": "Agent systems"},
                "book": None,
                "total_seconds": 5_400,
            }
        ],
        "events": [
            {
                "slug": "port-wren-agents-conference",
                "name": "Port Wren Agents Conference",
                "kind": "conference",
                "starts_on": "2026-02-19",
                "ends_on": "2026-02-20",
                "total_seconds": 19_800,
            }
        ],
    }
)

BOOKS = [
    PublicBook(
        slug="search-evaluation-handbook",
        title="A Fictional Handbook of Search Evaluation",
        author="Mara Placeholder",
        description="A fictional handbook on ranking metrics.",
        pages=312,
        year=2025,
        started_on=datetime.date(2026, 2, 2),
        ended_on=None,
        summary=None,
        status="reading",
        resource=PublicBookResource(
            slug="handbook-reading",
            name="Handbook reading",
            module="retrieval-evaluation",
            area="retrieval-engineering",
        ),
        reading_seconds=9_000,
    ),
]

EVENTS = [
    PublicEvent(
        slug="port-wren-agents-conference",
        name="Port Wren Agents Conference",
        kind="conference",
        organizer="Port Wren AI Guild",
        starts_on=datetime.date(2026, 2, 19),
        ends_on=datetime.date(2026, 2, 20),
        place="Port Wren",
        online=False,
        takeaways="Talks by other engineers on agent evaluation.",
        topics=["Agents"],
        attendance_seconds=19_800,
    ),
]


class FakeContent:
    """The public reads over fixed fictional records, or scripted failures and delays."""

    def __init__(
        self,
        person: PublicPerson | None = PERSON,
        *,
        fail: bool = False,
        experiences: Sequence[PublicExperience] = EXPERIENCES,
        projects: Sequence[PublicProject] = PROJECTS,
        explorations: Sequence[PublicExploration] = EXPLORATIONS,
        services: Sequence[PublicService] = SERVICES,
        education: Sequence[PublicEducation] = EDUCATION,
        current_focus: Sequence[PublicCurrentFocus] = CURRENT_FOCUS,
        roadmap: PublicRoadmap = ROADMAP,
        diary: Sequence[PublicDiaryDay] = DIARY,
        statistics: PublicLearningStatistics = STATISTICS,
        books: Sequence[PublicBook] = BOOKS,
        events: Sequence[PublicEvent] = EVENTS,
        delays: dict[str, float] | None = None,
    ) -> None:
        self.person = person
        self.fail = fail
        self.experiences = list(experiences)
        self.projects = list(projects)
        self.explorations = list(explorations)
        self.services = list(services)
        self.education = list(education)
        self.current_focus = list(current_focus)
        self.roadmap = roadmap
        self.diary = list(diary)
        self.statistics = statistics
        self.books = list(books)
        self.events = list(events)
        self.delays = delays or {}
        self.reads = 0
        #: Every read, in the order it started (`read_project` with its slug).
        self.calls: list[str] = []
        #: The most reads that were in flight at once.
        self.peak = 0
        self._active = 0

    async def _read(self, name: str) -> None:
        self.reads += 1
        self.calls.append(name)
        self._active += 1
        self.peak = max(self.peak, self._active)
        try:
            await asyncio.sleep(self.delays.get(name.split(":")[0], 0))
        finally:
            self._active -= 1
        if self.fail:
            raise ContentUnavailableError("the content API is unavailable")

    async def read_person(self) -> PublicPerson:
        await self._read("read_person")
        if self.person is None:
            raise ContentUnavailableError("the content API is unavailable")
        return self.person

    async def read_experiences(self) -> list[PublicExperience]:
        await self._read("read_experiences")
        return self.experiences

    async def read_projects(self) -> list[PublicProject]:
        await self._read("read_projects")
        return self.projects

    async def read_project(self, slug: str) -> PublicProject:
        await self._read(f"read_project:{slug}")
        project = next((p for p in self.projects if p.slug == slug), None)
        if project is None:
            raise ContentNotFoundError("no such project")
        return project

    async def read_explorations(self) -> list[PublicExploration]:
        await self._read("read_explorations")
        return self.explorations

    async def read_services(self) -> list[PublicService]:
        await self._read("read_services")
        return self.services

    async def read_education(self) -> list[PublicEducation]:
        await self._read("read_education")
        return self.education

    async def read_current_focus(self) -> list[PublicCurrentFocus]:
        await self._read("read_current_focus")
        return self.current_focus

    async def read_roadmap(self) -> PublicRoadmap:
        await self._read("read_roadmap")
        return self.roadmap

    async def read_roadmap_area(self, area: str) -> PublicRoadmapArea:
        await self._read(f"read_roadmap_area:{area}")
        found = next((a for a in self.roadmap.areas if a.slug == area), None)
        if found is None:
            raise ContentNotFoundError("no such area")
        return found

    async def read_diary(self) -> list[PublicDiaryDay]:
        await self._read("read_diary")
        return self.diary

    async def read_statistics(self) -> PublicLearningStatistics:
        await self._read("read_statistics")
        return self.statistics

    async def read_books(self) -> list[PublicBook]:
        await self._read("read_books")
        return self.books

    async def read_events(self) -> list[PublicEvent]:
        await self._read("read_events")
        return self.events


def calls(*requests: tuple[str, dict[str, Any]]) -> AIMessage:
    """One decision that asks for several tools, each with its own arguments."""
    return AIMessage(
        content="",
        tool_calls=[
            {"name": name, "args": dict(args), "id": f"call-{index}", "type": "tool_call"}
            for index, (name, args) in enumerate(requests, start=1)
        ],
        usage_metadata=USAGE,
        response_metadata={"stop_reason": "tool_use"},
    )


def message(payload: dict[str, Any], **metadata: Any) -> AIMessage:
    return AIMessage(
        content=json.dumps(payload),
        usage_metadata=metadata.pop("usage", USAGE),
        response_metadata={"stop_reason": "end_turn", **metadata},
    )


def verdict(value: str = "ALLOW", category: str = "none", reason: str = "ok") -> AIMessage:
    return message({"verdict": value, "category": category, "reason_code": reason})


def draft(
    text: str = "Ilsa Marrow is a fictional engineer who builds evaluated assistants.",
    *,
    outcome: str = "answered",
    language: str = "en",
    refs: Sequence[str] = ("src-1",),
    show_contact: bool = False,
) -> AIMessage:
    return message(
        {
            "outcome": outcome,
            "language": language,
            "text": text,
            "source_refs": list(refs),
            "show_contact": show_contact,
        }
    )


def tools(*names: str, args: dict[str, Any] | None = None) -> AIMessage:
    return AIMessage(
        content="",
        tool_calls=[
            {"name": name, "args": dict(args or {}), "id": f"call-{index}", "type": "tool_call"}
            for index, name in enumerate(names, start=1)
        ],
        usage_metadata=USAGE,
        response_metadata={"stop_reason": "tool_use"},
    )


def refusal() -> AIMessage:
    return AIMessage(content="", usage_metadata=USAGE, response_metadata={"stop_reason": "refusal"})


_REQUEST = httpx2.Request("POST", "https://api.anthropic.test/v1/messages")


def status_error(status: int) -> anthropic.APIStatusError:
    response = httpx2.Response(status, request=_REQUEST)
    kinds: dict[int, type[anthropic.APIStatusError]] = {
        400: anthropic.BadRequestError,
        429: anthropic.RateLimitError,
        500: anthropic.InternalServerError,
        529: anthropic.InternalServerError,
    }
    return kinds.get(status, anthropic.APIStatusError)("failed", response=response, body=None)


def connection_error() -> anthropic.APIConnectionError:
    return anthropic.APIConnectionError(request=_REQUEST)


def spans(result: Any) -> list[tuple[str, str]]:
    return [(span.name, span.status) for span in result.trace]


def span(result: Any, name: str) -> Any:
    """The first span of that name."""
    return next(item for item in result.trace if item.name == name)
