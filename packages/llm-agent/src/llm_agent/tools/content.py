"""The public content the agent may read, over the generated client of the content API.

This module is the handwritten allowlist: it calls only public read routes, sends no credential
and maps the generated models to the package's own read models. Every failure (connection, status,
malformed body) becomes `ContentUnavailableError`, so callers never see transport details; a
missing project or roadmap area is the narrower `ContentNotFoundError`. A project or area slug is
validated before any request. The read models carry no outside URL, id, ISBN or timestamp: project,
focus, resource and event links, service link evidence, logos, covers and testimonials are not
read. Learning progress, statuses and time totals are the API's own; nothing here recomputes them.
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
from sebela_api_client import Client
from sebela_api_client.api.default import (
    get_person,
    get_project,
    get_roadmap,
    get_roadmap_area_detail,
    get_roadmap_diary,
    get_roadmap_statistics,
    list_current_focus,
    list_education,
    list_experiences,
    list_explorations,
    list_projects,
    list_roadmap_books,
    list_roadmap_events,
    list_services,
)
from sebela_api_client.models.current_focus import CurrentFocus
from sebela_api_client.models.diary import Diary
from sebela_api_client.models.diary_day import DiaryDay
from sebela_api_client.models.diary_event import DiaryEvent
from sebela_api_client.models.diary_resource import DiaryResource
from sebela_api_client.models.education import Education
from sebela_api_client.models.experience import Experience
from sebela_api_client.models.exploration import Exploration
from sebela_api_client.models.learning_time_area import LearningTimeArea
from sebela_api_client.models.learning_time_event import LearningTimeEvent
from sebela_api_client.models.learning_time_resource import LearningTimeResource
from sebela_api_client.models.person import Person
from sebela_api_client.models.project import Project
from sebela_api_client.models.roadmap import Roadmap
from sebela_api_client.models.roadmap_area_detail import RoadmapAreaDetail
from sebela_api_client.models.roadmap_book import RoadmapBook
from sebela_api_client.models.roadmap_event import RoadmapEvent
from sebela_api_client.models.roadmap_progress import RoadmapProgress
from sebela_api_client.models.roadmap_statistics import RoadmapStatistics
from sebela_api_client.models.roadmap_tree_area import RoadmapTreeArea
from sebela_api_client.models.roadmap_tree_module import RoadmapTreeModule
from sebela_api_client.models.roadmap_tree_resource import RoadmapTreeResource
from sebela_api_client.models.service import Service
from sebela_api_client.models.service_exploration_evidence import (
    ServiceExplorationEvidence,
)
from sebela_api_client.models.service_project_evidence import (
    ServiceProjectEvidence,
)
from sebela_api_client.types import Response

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


RoadmapStatus = Literal["planned", "in-progress", "completed"]
ResourceStatus = Literal["planned", "in-progress", "paused", "completed", "skipped"]
BookStatus = Literal["to-read", "reading", "completed"]
EventKind = Literal["conference", "meetup", "workshop", "lecture"]


class PublicFocusProject(_Read):
    """The project a current-focus entry builds on, with the slug of its experience."""

    slug: Slug
    name: str
    experience: Slug


class PublicCurrentFocus(_Read):
    """What the person is focused on now; a focus, not delivered work."""

    slug: Slug
    title: str
    description: str
    project: PublicFocusProject | None
    topics: list[str]


class PublicProgress(_Read):
    """The API's own progress of an area or module: completed of total resources and status."""

    completed: int
    total: int
    status: RoadmapStatus
    estimated_minutes: int


class PublicRoadmapResource(_Read):
    """A learning resource of a module; `book` is the slug of the book it links, if any."""

    slug: Slug
    name: str
    description: str | None
    type: str
    status: ResourceStatus
    estimated_minutes: int | None
    book: Slug | None
    topics: list[str]


class PublicRoadmapModule(_Read):
    slug: Slug
    name: str
    description: str | None
    progress: PublicProgress
    resources: list[PublicRoadmapResource]


class PublicRoadmapArea(_Read):
    slug: Slug
    name: str
    description: str | None
    progress: PublicProgress
    modules: list[PublicRoadmapModule]


class PublicRoadmapSummary(_Read):
    """The whole roadmap's counts as the API computes them; estimated minutes are not logged."""

    area_count: int
    module_count: int
    resource_count: int
    completed: int
    total: int
    estimated_minutes: int


class PublicRoadmap(_Read):
    summary: PublicRoadmapSummary
    areas: list[PublicRoadmapArea]


class PublicDiaryResource(_Read):
    """The resource a session was logged on; `module` and `area` are slugs."""

    slug: Slug
    name: str
    type: str
    module: Slug
    area: Slug


class PublicDiaryEvent(_Read):
    """An attended event with its inclusive calendar dates."""

    slug: Slug
    name: str
    kind: EventKind
    starts_on: datetime.date
    ends_on: datetime.date


class PublicDiarySession(_Read):
    """One logged session: exactly one of resource or event, and its elapsed seconds."""

    resource: PublicDiaryResource | None
    event: PublicDiaryEvent | None
    duration_seconds: int


class PublicDiaryDay(_Read):
    """One Europe/Prague calendar day of the learning diary, as the API derives it."""

    date: datetime.date
    notes: str | None
    sessions: list[PublicDiarySession]
    events: list[PublicDiaryEvent]
    total_seconds: int


class PublicLearningTime(_Read):
    """Logged seconds split by target: roadmap resources, books (resource time) and events."""

    total_seconds: int
    resource_seconds: int
    book_seconds: int
    event_seconds: int


class PublicLearningTotals(PublicLearningTime):
    active_days: int


class PublicLearningWeek(PublicLearningTime):
    """A Monday-start Europe/Prague week."""

    starts_on: datetime.date


class PublicLearningMonth(PublicLearningTime):
    """A Europe/Prague calendar month, such as `2026-03`."""

    month: str


class PublicLearningModule(_Read):
    slug: Slug
    name: str
    total_seconds: int
    resource_seconds: int
    book_seconds: int


class PublicLearningArea(_Read):
    slug: Slug
    name: str
    total_seconds: int
    resource_seconds: int
    book_seconds: int
    modules: list[PublicLearningModule]


class PublicNamed(_Read):
    slug: Slug
    name: str


class PublicLearningResource(_Read):
    """A resource's logged seconds; `book` is the title of the book it links, if any."""

    slug: Slug
    name: str
    type: str
    category: str
    module: PublicNamed
    area: PublicNamed
    book: str | None
    total_seconds: int


class PublicLearningEvent(_Read):
    slug: Slug
    name: str
    kind: EventKind
    starts_on: datetime.date
    ends_on: datetime.date
    total_seconds: int


class PublicLearningStatistics(_Read):
    """The API's learning-time aggregates; the per-day series is not read."""

    totals: PublicLearningTotals
    weeks: list[PublicLearningWeek]
    months: list[PublicLearningMonth]
    areas: list[PublicLearningArea]
    resources: list[PublicLearningResource]
    events: list[PublicLearningEvent]


class PublicBookResource(_Read):
    """The roadmap resource that links a book; `module` and `area` are slugs."""

    slug: Slug
    name: str
    module: Slug
    area: Slug


class PublicBook(_Read):
    """A bookshelf entry; `reading_seconds` is the logged time of its linked resource."""

    slug: Slug
    title: str
    author: str | None
    description: str | None
    pages: int | None
    year: int | None
    started_on: datetime.date | None
    ended_on: datetime.date | None
    summary: str | None
    status: BookStatus
    resource: PublicBookResource | None
    reading_seconds: int


class PublicEvent(_Read):
    """An attended event; `attendance_seconds` is the time logged on it, not its length."""

    slug: Slug
    name: str
    kind: EventKind
    organizer: str | None
    starts_on: datetime.date
    ends_on: datetime.date
    place: str | None
    online: bool
    takeaways: str | None
    topics: list[str]
    attendance_seconds: int


class ContentReader(Protocol):
    """The public reads the agent's tools use."""

    async def read_person(self) -> PublicPerson: ...

    async def read_experiences(self) -> list[PublicExperience]: ...

    async def read_projects(self) -> list[PublicProject]: ...

    async def read_project(self, slug: str) -> PublicProject: ...

    async def read_explorations(self) -> list[PublicExploration]: ...

    async def read_services(self) -> list[PublicService]: ...

    async def read_education(self) -> list[PublicEducation]: ...

    async def read_current_focus(self) -> list[PublicCurrentFocus]: ...

    async def read_roadmap(self) -> PublicRoadmap: ...

    async def read_roadmap_area(self, area: str) -> PublicRoadmapArea: ...

    async def read_diary(self) -> list[PublicDiaryDay]: ...

    async def read_statistics(self) -> PublicLearningStatistics: ...

    async def read_books(self) -> list[PublicBook]: ...

    async def read_events(self) -> list[PublicEvent]: ...


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


def _focus(focus: CurrentFocus) -> PublicCurrentFocus:
    project = focus.project
    return PublicCurrentFocus(
        slug=focus.slug,
        title=focus.title,
        description=focus.description,
        project=PublicFocusProject(
            slug=project.slug, name=project.name, experience=project.experience
        )
        if project
        else None,
        topics=[topic.name for topic in focus.topics],
    )


def _progress(progress: RoadmapProgress) -> PublicProgress:
    return PublicProgress.model_validate(
        {
            "completed": progress.completed,
            "total": progress.total,
            "status": str(progress.status),
            "estimated_minutes": progress.estimated_minutes,
        }
    )


def _resource(resource: RoadmapTreeResource) -> PublicRoadmapResource:
    return PublicRoadmapResource.model_validate(
        {
            "slug": resource.slug,
            "name": resource.name,
            "description": resource.description,
            "type": str(resource.type_),
            "status": str(resource.status),
            "estimated_minutes": resource.estimated_minutes,
            "book": resource.book,
            "topics": [topic.name for topic in resource.topics],
        }
    )


def _module(module: RoadmapTreeModule) -> PublicRoadmapModule:
    return PublicRoadmapModule(
        slug=module.slug,
        name=module.name,
        description=module.description,
        progress=_progress(module.progress),
        resources=[_resource(resource) for resource in module.resources],
    )


def _area(area: RoadmapTreeArea) -> PublicRoadmapArea:
    return PublicRoadmapArea(
        slug=area.slug,
        name=area.name,
        description=area.description,
        progress=_progress(area.progress),
        modules=[_module(module) for module in area.modules],
    )


def _roadmap(roadmap: Roadmap) -> PublicRoadmap:
    summary = roadmap.summary
    return PublicRoadmap(
        summary=PublicRoadmapSummary(
            area_count=summary.area_count,
            module_count=summary.module_count,
            resource_count=summary.resource_count,
            completed=summary.completed,
            total=summary.total,
            estimated_minutes=summary.estimated_minutes,
        ),
        areas=[_area(area) for area in roadmap.areas],
    )


def _diary_event(event: DiaryEvent) -> PublicDiaryEvent:
    return PublicDiaryEvent.model_validate(
        {
            "slug": event.slug,
            "name": event.name,
            "kind": str(event.kind),
            "starts_on": event.starts_on,
            "ends_on": event.ends_on,
        }
    )


def _diary_resource(resource: DiaryResource) -> PublicDiaryResource:
    return PublicDiaryResource(
        slug=resource.slug,
        name=resource.name,
        type=str(resource.type_),
        module=resource.module,
        area=resource.area,
    )


def _diary_day(day: DiaryDay) -> PublicDiaryDay:
    return PublicDiaryDay(
        date=day.date,
        notes=day.notes,
        sessions=[
            PublicDiarySession(
                resource=_diary_resource(entry.resource) if entry.resource else None,
                event=_diary_event(entry.event) if entry.event else None,
                duration_seconds=entry.duration_seconds,
            )
            for entry in day.entries
        ],
        events=[_diary_event(event) for event in day.events],
        total_seconds=day.total_seconds,
    )


def _time(value: Any) -> dict[str, int]:
    return {
        "total_seconds": value.total_seconds,
        "resource_seconds": value.resource_seconds,
        "book_seconds": value.book_seconds,
        "event_seconds": value.event_seconds,
    }


def _learning_area(area: LearningTimeArea) -> PublicLearningArea:
    return PublicLearningArea(
        slug=area.slug,
        name=area.name,
        total_seconds=area.total_seconds,
        resource_seconds=area.resource_seconds,
        book_seconds=area.book_seconds,
        modules=[
            PublicLearningModule(
                slug=module.slug,
                name=module.name,
                total_seconds=module.total_seconds,
                resource_seconds=module.resource_seconds,
                book_seconds=module.book_seconds,
            )
            for module in area.modules
        ],
    )


def _learning_resource(resource: LearningTimeResource) -> PublicLearningResource:
    return PublicLearningResource(
        slug=resource.slug,
        name=resource.name,
        type=str(resource.type_),
        category=str(resource.category),
        module=PublicNamed(slug=resource.module.slug, name=resource.module.name),
        area=PublicNamed(slug=resource.area.slug, name=resource.area.name),
        book=resource.book.title if resource.book else None,
        total_seconds=resource.total_seconds,
    )


def _learning_event(event: LearningTimeEvent) -> PublicLearningEvent:
    return PublicLearningEvent.model_validate(
        {
            "slug": event.slug,
            "name": event.name,
            "kind": str(event.kind),
            "starts_on": event.starts_on,
            "ends_on": event.ends_on,
            "total_seconds": event.total_seconds,
        }
    )


def _statistics(statistics: RoadmapStatistics) -> PublicLearningStatistics:
    totals = statistics.totals
    return PublicLearningStatistics(
        totals=PublicLearningTotals(**_time(totals), active_days=totals.active_days),
        weeks=[
            PublicLearningWeek(starts_on=week.starts_on, **_time(week)) for week in statistics.weeks
        ],
        months=[
            PublicLearningMonth(month=month.month, **_time(month)) for month in statistics.months
        ],
        areas=[_learning_area(area) for area in statistics.areas],
        resources=[_learning_resource(resource) for resource in statistics.resources],
        events=[_learning_event(event) for event in statistics.events],
    )


def _book(book: RoadmapBook) -> PublicBook:
    resource = book.resource
    return PublicBook.model_validate(
        {
            "slug": book.slug,
            "title": book.title,
            "author": book.author,
            "description": book.description,
            "pages": book.pages,
            "year": book.year,
            "started_on": book.started_on,
            "ended_on": book.ended_on,
            "summary": book.summary,
            "status": str(book.status),
            "resource": PublicBookResource(
                slug=resource.slug, name=resource.name, module=resource.module, area=resource.area
            )
            if resource
            else None,
            "reading_seconds": book.reading_seconds,
        }
    )


def _event(event: RoadmapEvent) -> PublicEvent:
    return PublicEvent.model_validate(
        {
            "slug": event.slug,
            "name": event.name,
            "kind": str(event.kind),
            "organizer": event.organizer,
            "starts_on": event.starts_on,
            "ends_on": event.ends_on,
            "place": event.place,
            "online": event.online,
            "takeaways": event.takeaways,
            "topics": [topic.name for topic in event.topics],
            "attendance_seconds": event.attendance_seconds,
        }
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

    async def read_current_focus(self) -> list[PublicCurrentFocus]:
        items = await self._fetch(list_current_focus.asyncio_detailed(client=self._client), list)
        return self._map(lambda rows: [_focus(row) for row in rows], items)

    async def read_roadmap(self) -> PublicRoadmap:
        roadmap = await self._fetch(get_roadmap.asyncio_detailed(client=self._client), Roadmap)
        return self._map(_roadmap, roadmap)

    async def read_roadmap_area(self, area: str) -> PublicRoadmapArea:
        if not valid_slug(area):
            raise ValueError("the roadmap area slug is not a valid slug")
        detail = await self._fetch(
            get_roadmap_area_detail.asyncio_detailed(area, client=self._client),
            RoadmapAreaDetail,
            found=True,
        )
        return self._map(_area, detail.area)

    async def read_diary(self) -> list[PublicDiaryDay]:
        diary = await self._fetch(get_roadmap_diary.asyncio_detailed(client=self._client), Diary)
        return self._map(lambda value: [_diary_day(day) for day in value.days], diary)

    async def read_statistics(self) -> PublicLearningStatistics:
        statistics = await self._fetch(
            get_roadmap_statistics.asyncio_detailed(client=self._client), RoadmapStatistics
        )
        return self._map(_statistics, statistics)

    async def read_books(self) -> list[PublicBook]:
        items = await self._fetch(list_roadmap_books.asyncio_detailed(client=self._client), list)
        return self._map(lambda rows: [_book(row) for row in rows], items)

    async def read_events(self) -> list[PublicEvent]:
        items = await self._fetch(list_roadmap_events.asyncio_detailed(client=self._client), list)
        return self._map(lambda rows: [_event(row) for row in rows], items)

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
