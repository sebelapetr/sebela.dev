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
    PublicCaseStudy,
    PublicEducation,
    PublicExperience,
    PublicExploration,
    PublicLink,
    PublicPerson,
    PublicProject,
    PublicProjectSummary,
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
        delays: dict[str, float] | None = None,
    ) -> None:
        self.person = person
        self.fail = fail
        self.experiences = list(experiences)
        self.projects = list(projects)
        self.explorations = list(explorations)
        self.services = list(services)
        self.education = list(education)
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
