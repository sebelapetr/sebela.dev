"""The public content the agent may read, over the generated client of the content API.

This module is the handwritten allowlist: it calls only public read routes, sends no credential
and maps the generated models to the package's own read models. Every failure (connection, status,
malformed body) becomes `ContentUnavailableError`, so callers never see transport details; a
missing project is the narrower `ContentNotFoundError`. A project slug is validated before any
request. The read models carry no outside URL: project links, service link evidence, logos and
testimonials are not read.
"""

from __future__ import annotations

import datetime
import re
from collections.abc import Awaitable, Callable
from types import TracebackType
from typing import Annotated, Any, Final, Literal, Protocol, Self, cast, get_args
from urllib.parse import urlsplit

import httpx2
from pydantic import BaseModel, ConfigDict, Field

from llm_agent.generated.content_api import Client
from llm_agent.generated.content_api.api.default import (
    get_person,
    get_project,
    list_education,
    list_experiences,
    list_explorations,
    list_projects,
    list_services,
)
from llm_agent.generated.content_api.models.education import Education
from llm_agent.generated.content_api.models.experience import Experience
from llm_agent.generated.content_api.models.exploration import Exploration
from llm_agent.generated.content_api.models.person import Person
from llm_agent.generated.content_api.models.project import Project
from llm_agent.generated.content_api.models.service import Service
from llm_agent.generated.content_api.models.service_exploration_evidence import (
    ServiceExplorationEvidence,
)
from llm_agent.generated.content_api.models.service_project_evidence import (
    ServiceProjectEvidence,
)
from llm_agent.generated.content_api.types import Response

#: Transport timeout of one content read; the tool call timeout bounds it further.
READ_TIMEOUT_S = 5.0


#: A record slug as the content API defines it; also the bound of the `get_project` argument.
SLUG_PATTERN: Final = r"^[a-z0-9]+(?:-[a-z0-9]+)*$"
SLUG_MAX_LENGTH: Final = 100
_SLUG = re.compile(SLUG_PATTERN)

Slug = Annotated[str, Field(pattern=SLUG_PATTERN, max_length=SLUG_MAX_LENGTH)]
ExplorationStatus = Literal["built", "tested", "designed"]


def valid_slug(value: object) -> bool:
    return isinstance(value, str) and len(value) <= SLUG_MAX_LENGTH and bool(_SLUG.match(value))


class ContentUnavailableError(Exception):
    """The content API could not return the requested public record."""


class ContentNotFoundError(ContentUnavailableError):
    """The requested public record does not exist."""


class _Read(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class PublicLink(_Read):
    label: str
    url: str


class PublicStep(_Read):
    title: str
    description: str


class PublicPerson(_Read):
    """The public profile of the person the site is about."""

    id: str
    name: str
    headline: str
    short_bio: str
    long_bio: str | None
    location: str | None
    email: str | None
    links: list[PublicLink]
    availability: str | None
    career_started_on: datetime.date | None
    services_intro: str | None
    collaboration_steps: list[PublicStep]
    services_note: str | None


class PublicProjectSummary(_Read):
    """A project as its experience lists it."""

    slug: Slug
    name: str
    started_on: datetime.date
    ended_on: datetime.date | None


class PublicExperience(_Read):
    """A job, contract or other role; `organization` is the organisation's name."""

    id: str
    slug: Slug
    title: str
    kind: str
    organization: str
    started_on: datetime.date
    ended_on: datetime.date | None
    summary: str
    responsibilities: list[str]
    technologies: list[str]
    projects: list[PublicProjectSummary]


class PublicCaseStudy(_Read):
    role: str
    body: str


class PublicProject(_Read):
    """A project; `experience` is the slug of the experience it belongs to."""

    id: str
    slug: Slug
    experience: Slug
    name: str
    summary: str
    problem: str
    work_done: str
    result: str
    started_on: datetime.date
    ended_on: datetime.date | None
    technologies: list[str]
    case_study: PublicCaseStudy | None


class PublicExploration(_Read):
    """Exploratory work with its stored status: built, tested or only designed."""

    id: str
    slug: Slug
    name: str
    summary: str
    status: ExplorationStatus
    concepts: list[str]
    started_on: datetime.date
    ended_on: datetime.date | None
    technologies: list[str]
    topics: list[str]


class PublicServiceEvidence(_Read):
    """A project or exploration a service rests on; only an exploration has a status."""

    kind: Literal["project", "exploration"]
    slug: Slug
    name: str
    summary: str
    status: ExplorationStatus | None


class PublicService(_Read):
    id: str
    slug: Slug
    name: str
    summary: str
    audience: str
    deliverable: str
    evidence: list[PublicServiceEvidence]


class PublicEducation(_Read):
    """A school, course, certification or milestone; missing dates stay missing."""

    id: str
    slug: Slug
    kind: str
    title: str
    institution: str | None
    started_on: datetime.date | None
    ended_on: datetime.date | None
    description: str | None


class ContentReader(Protocol):
    """The public reads the agent's tools use."""

    async def read_person(self) -> PublicPerson: ...

    async def read_experiences(self) -> list[PublicExperience]: ...

    async def read_projects(self) -> list[PublicProject]: ...

    async def read_project(self, slug: str) -> PublicProject: ...

    async def read_explorations(self) -> list[PublicExploration]: ...

    async def read_services(self) -> list[PublicService]: ...

    async def read_education(self) -> list[PublicEducation]: ...


def _person(person: Person) -> PublicPerson:
    return PublicPerson(
        id=str(person.id),
        name=person.name,
        headline=person.headline,
        short_bio=person.short_bio,
        long_bio=person.long_bio,
        location=person.location,
        email=person.email,
        links=[PublicLink(label=link.label, url=link.url) for link in person.links],
        availability=person.availability,
        career_started_on=person.career_started_on,
        services_intro=person.services_intro,
        collaboration_steps=[
            PublicStep(title=step.title, description=step.description)
            for step in person.collaboration_steps
        ],
        services_note=person.services_note,
    )


def _status(value: object) -> ExplorationStatus:
    status = str(value)
    for known in get_args(ExplorationStatus):
        if status == known:
            return cast("ExplorationStatus", known)
    raise ValueError("an unknown exploration status")


def _project_summary(project: Project) -> PublicProjectSummary:
    return PublicProjectSummary(
        slug=project.slug,
        name=project.name,
        started_on=project.started_on,
        ended_on=project.ended_on,
    )


def _experience(experience: Experience) -> PublicExperience:
    return PublicExperience(
        id=str(experience.id),
        slug=experience.slug,
        title=experience.title,
        kind=str(experience.kind),
        organization=experience.organization.name,
        started_on=experience.started_on,
        ended_on=experience.ended_on,
        summary=experience.summary,
        responsibilities=list(experience.responsibilities),
        technologies=[technology.name for technology in experience.technologies],
        projects=[_project_summary(project) for project in experience.projects],
    )


def _project(project: Project) -> PublicProject:
    study = project.case_study
    return PublicProject(
        id=str(project.id),
        slug=project.slug,
        experience=project.experience,
        name=project.name,
        summary=project.summary,
        problem=project.problem,
        work_done=project.work_done,
        result=project.result,
        started_on=project.started_on,
        ended_on=project.ended_on,
        technologies=[technology.name for technology in project.technologies],
        case_study=PublicCaseStudy(role=study.role, body=study.body) if study else None,
    )


def _exploration(exploration: Exploration) -> PublicExploration:
    return PublicExploration(
        id=str(exploration.id),
        slug=exploration.slug,
        name=exploration.name,
        summary=exploration.summary,
        status=_status(exploration.status),
        concepts=list(exploration.concepts),
        started_on=exploration.started_on,
        ended_on=exploration.ended_on,
        technologies=[technology.name for technology in exploration.technologies],
        topics=[topic.name for topic in exploration.topics],
    )


def _service(service: Service) -> PublicService:
    evidence: list[PublicServiceEvidence] = []
    for item in service.evidence:
        if isinstance(item, ServiceProjectEvidence):
            project = item.project
            evidence.append(
                PublicServiceEvidence(
                    kind="project",
                    slug=project.slug,
                    name=project.name,
                    summary=project.summary,
                    status=None,
                )
            )
        elif isinstance(item, ServiceExplorationEvidence):
            exploration = item.exploration
            evidence.append(
                PublicServiceEvidence(
                    kind="exploration",
                    slug=exploration.slug,
                    name=exploration.name,
                    summary=exploration.summary,
                    status=_status(exploration.status),
                )
            )
    return PublicService(
        id=str(service.id),
        slug=service.slug,
        name=service.name,
        summary=service.summary,
        audience=service.audience,
        deliverable=service.deliverable,
        evidence=evidence,
    )


def _education(education: Education) -> PublicEducation:
    return PublicEducation(
        id=str(education.id),
        slug=education.slug,
        kind=str(education.kind),
        title=education.title,
        institution=education.institution,
        started_on=education.started_on,
        ended_on=education.ended_on,
        description=education.description,
    )


class ApiContentReader:
    """Reads public content from the API at `base_url`. Use it as an async context manager."""

    def __init__(
        self, base_url: str, *, transport: httpx2.AsyncBaseTransport | None = None
    ) -> None:
        if urlsplit(base_url).scheme not in ("http", "https"):
            raise ValueError("the content API URL must be an http or https URL")
        self._http = httpx2.AsyncClient(
            base_url=base_url, timeout=READ_TIMEOUT_S, transport=transport, follow_redirects=False
        )
        self._client = Client(base_url=base_url).set_async_httpx_client(self._http)

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        await self._http.aclose()

    async def read_person(self) -> PublicPerson:
        person = await self._fetch(get_person.asyncio_detailed(client=self._client), Person)
        return self._map(_person, person)

    async def read_experiences(self) -> list[PublicExperience]:
        items = await self._fetch(list_experiences.asyncio_detailed(client=self._client), list)
        return self._map(lambda rows: [_experience(row) for row in rows], items)

    async def read_projects(self) -> list[PublicProject]:
        items = await self._fetch(list_projects.asyncio_detailed(client=self._client), list)
        return self._map(lambda rows: [_project(row) for row in rows], items)

    async def read_project(self, slug: str) -> PublicProject:
        if not valid_slug(slug):
            raise ValueError("the project slug is not a valid slug")
        project = await self._fetch(
            get_project.asyncio_detailed(slug, client=self._client), Project, found=True
        )
        return self._map(_project, project)

    async def read_explorations(self) -> list[PublicExploration]:
        items = await self._fetch(list_explorations.asyncio_detailed(client=self._client), list)
        return self._map(lambda rows: [_exploration(row) for row in rows], items)

    async def read_services(self) -> list[PublicService]:
        items = await self._fetch(list_services.asyncio_detailed(client=self._client), list)
        return self._map(lambda rows: [_service(row) for row in rows], items)

    async def read_education(self) -> list[PublicEducation]:
        items = await self._fetch(list_education.asyncio_detailed(client=self._client), list)
        return self._map(lambda rows: [_education(row) for row in rows], items)

    @staticmethod
    async def _fetch[T](
        request: Awaitable[Response[Any]], expected: type[T], *, found: bool = False
    ) -> T:
        """The parsed 200 body; with `found`, a 404 is `ContentNotFoundError`."""
        try:
            response = await request
        except (httpx2.HTTPError, KeyError, TypeError, ValueError, AttributeError) as error:
            raise ContentUnavailableError("the public content could not be read") from error
        if found and response.status_code == 404:
            raise ContentNotFoundError("the public record does not exist")
        if response.status_code != 200 or not isinstance(response.parsed, expected):
            raise ContentUnavailableError("the public content could not be read")
        return response.parsed

    @staticmethod
    def _map[S, T](mapping: Callable[[S], T], value: S) -> T:
        try:
            return mapping(value)
        except (ValueError, AttributeError, TypeError) as error:
            raise ContentUnavailableError("the public content is malformed") from error
