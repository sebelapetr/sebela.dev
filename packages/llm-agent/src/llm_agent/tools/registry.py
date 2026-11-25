"""The allowlisted read tools, their execution and this turn's evidence ledger.

The tools are the public profile and contact reads, the career reads (experiences, projects, one
project's detail, services, explorations and education) and the learning reads (current focus, the
roadmap tree, one area's detail, the learning diary, learning statistics, books and events). A
requested tool outside the allowlist is rejected and never executed; arguments are validated
before any read (only `get_project` and `get_roadmap_area` take one, a bounded slug). Every result
is projected (no ids, no outside URLs; logged seconds and estimated minutes become the website's
formatted times), checked against the record and token caps (rejected, never truncated), checked
against the turn's total tool context and recorded as evidence with a turn-local ref before it
reaches the model.

Each read runs at most once per execution; at most `MAX_CONCURRENT_READS` independent reads run at
once. Results, evidence refs and trace spans follow the order of the model's requests, not the
order the reads finish in. Each record keeps its own identity (its slug) and canonical site link,
so a project cited after listing an experience is still the project's own source, and a module
cited after listing the roadmap is the module's own source. Identity is the kind and the slug, so a
book and an event with the same slug stay two sources.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Final, Literal, get_args

from pydantic import BaseModel, ValidationError

from llm_agent.context.tokens import json_tokens
from llm_agent.observability.tracing import Tracer
from llm_agent.reliability.timeouts import Deadline
from llm_agent.schemas import (
    Block,
    ContactCard,
    ContactLink,
    Evidence,
    ExperienceCard,
    ExplorationCard,
    RoadmapCard,
    ServiceCard,
    SourceKind,
    ToolName,
)
from llm_agent.tools.content import (
    SLUG_MAX_LENGTH,
    SLUG_PATTERN,
    ContentNotFoundError,
    ContentReader,
    ContentUnavailableError,
    PublicBook,
    PublicCurrentFocus,
    PublicDiaryDay,
    PublicEducation,
    PublicEvent,
    PublicExperience,
    PublicExploration,
    PublicLearningStatistics,
    PublicPerson,
    PublicProject,
    PublicRoadmap,
    PublicRoadmapArea,
    PublicService,
    PublicTechnology,
    valid_slug,
)

#: Records one list result may carry; a longer list is rejected, never truncated.
MAX_RECORDS: Final = 30
#: Tokens all tool results of one execution may add to the model context.
CONTEXT_TOKENS: Final = 10_000
#: Independent reads that may run at the same time.
MAX_CONCURRENT_READS: Final = 3
#: Typed blocks one answer may carry.
MAX_BLOCKS: Final = 3

_NO_ARGUMENTS: Final = {"type": "object", "properties": {}, "additionalProperties": False}

TOOL_SPECS: Final[tuple[dict[str, Any], ...]] = (
    {
        "name": "get_profile",
        "description": (
            "Read the published professional profile: name, headline, biography, location,"
            " availability, career start, services introduction, collaboration steps and the"
            " services note."
        ),
        "input_schema": _NO_ARGUMENTS,
    },
    {
        "name": "get_contact",
        "description": "Read the published contact details: name, e-mail address and links.",
        "input_schema": _NO_ARGUMENTS,
    },
    {
        "name": "list_experiences",
        "description": (
            "Read every published experience (job, contract or other role): title, kind,"
            " organization, start and end dates (no end date means current), summary,"
            " responsibilities, technologies and the projects it contains."
        ),
        "input_schema": _NO_ARGUMENTS,
    },
    {
        "name": "list_projects",
        "description": (
            "Read every published project: the experience it belongs to, summary, problem, work"
            " done, result, dates, technologies and whether it has a case study."
        ),
        "input_schema": _NO_ARGUMENTS,
    },
    {
        "name": "get_project",
        "description": (
            "Read one published project by its slug, including its case study (role and body)"
            " when it has one."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "slug": {
                    "type": "string",
                    "pattern": SLUG_PATTERN,
                    "maxLength": SLUG_MAX_LENGTH,
                    "description": "The project slug that list_projects or an experience gives.",
                }
            },
            "required": ["slug"],
            "additionalProperties": False,
        },
    },
    {
        "name": "list_services",
        "description": (
            "Read every published service: summary, audience, deliverable and the projects and"
            " explorations it rests on, with each exploration's status."
        ),
        "input_schema": _NO_ARGUMENTS,
    },
    {
        "name": "list_explorations",
        "description": (
            "Read every published exploration with its stored status: built, tested (tried, not"
            " delivered) or designed (not implemented); also concepts, dates, technologies and"
            " topics."
        ),
        "input_schema": _NO_ARGUMENTS,
    },
    {
        "name": "list_education",
        "description": (
            "Read every published education record: school, course, certification or milestone,"
            " with its institution and dates where they are published."
        ),
        "input_schema": _NO_ARGUMENTS,
    },
    {
        "name": "list_current_focus",
        "description": (
            "Read what the person is focused on now: each focus entry's title, description,"
            " topics and the project it builds on, if any. A focus is current, not delivered work."
        ),
        "input_schema": _NO_ARGUMENTS,
    },
    {
        "name": "get_roadmap",
        "description": (
            "Read the AI Roadmap of what the person is learning: overall counts and progress, and"
            " every area with its stored progress (completed of total resources, status, estimated"
            " time) and its modules' progress. Estimated time is a plan, not logged time."
        ),
        "input_schema": _NO_ARGUMENTS,
    },
    {
        "name": "get_roadmap_area",
        "description": (
            "Read one AI Roadmap area by its slug with every module and each module's learning"
            " resources: type, stored status, estimated time, linked book and topics."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "area": {
                    "type": "string",
                    "pattern": SLUG_PATTERN,
                    "maxLength": SLUG_MAX_LENGTH,
                    "description": "The area slug that get_roadmap gives.",
                }
            },
            "required": ["area"],
            "additionalProperties": False,
        },
    },
    {
        "name": "get_learning_diary",
        "description": (
            "Read the learning diary: each Europe/Prague calendar day with its notes, the logged"
            " study sessions (resource or attended event, and time) and the day's total logged"
            " time. Newest day first."
        ),
        "input_schema": _NO_ARGUMENTS,
    },
    {
        "name": "get_learning_statistics",
        "description": (
            "Read the logged learning time as the website computes it: totals and active days,"
            " per Monday-start week, per calendar month, per area and module, per resource and"
            " per attended event, split into resource, book and event time."
        ),
        "input_schema": _NO_ARGUMENTS,
    },
    {
        "name": "list_books",
        "description": (
            "Read the bookshelf: each book's author, year, pages, stored status (to-read, reading,"
            " completed), dates, summary, the roadmap resource it belongs to and the reading time"
            " logged on that resource."
        ),
        "input_schema": _NO_ARGUMENTS,
    },
    {
        "name": "list_events",
        "description": (
            "Read the conferences, meetups, workshops and lectures the person attended: organizer,"
            " dates, place, takeaways, topics and the attendance time logged on each."
        ),
        "input_schema": _NO_ARGUMENTS,
    },
)

#: The allowlist, in the order the model is offered it.
TOOLS: Final[tuple[ToolName, ...]] = get_args(ToolName)
#: The source kind of the person-level reads.
_PERSON_KIND: Final[dict[ToolName, SourceKind]] = {
    "get_profile": "profile",
    "get_contact": "contact",
}
#: The canonical site page of the profile and contact sources.
CANONICAL_HREF: Final[dict[SourceKind, str]] = {"profile": "/", "contact": "/#contact"}
#: The canonical site page of a record of each kind (`apps/web` routes and anchors); `{area}` is a
#: module's area slug, `{year}` an event's start year and a diary day's slug is its date.
RECORD_HREF: Final[dict[SourceKind, str]] = {
    "experience": "/experience#experience-{slug}",
    "project": "/experience#project-{slug}",
    "exploration": "/experience#exploration-{slug}",
    "service": "/services#service-{slug}",
    "education": "/experience#education-heading",
    "current_focus": "/#now-heading",
    "roadmap": "/ai-roadmap",
    "roadmap_area": "/ai-roadmap/{slug}",
    "roadmap_module": "/ai-roadmap/{area}/{slug}",
    "diary_day": "/ai-roadmap/diary/{slug}",
    "statistics": "/ai-roadmap/diary/stats",
    "book": "/ai-roadmap/bookshelf/{slug}",
    "event": "/ai-roadmap/events#events-{year}",
}
#: The record id of the two singleton learning sources.
ROADMAP_ID: Final = "ai-roadmap"
STATISTICS_ID: Final = "learning-statistics"


@dataclass(frozen=True)
class _Record:
    kind: SourceKind
    slug: str
    title: str
    href: str
    data: dict[str, Any]


def _record(kind: SourceKind, slug: str, title: str, data: dict[str, Any], **href: str) -> _Record:
    return _Record(kind, slug, title, RECORD_HREF[kind].format(slug=slug, **href), data)


@dataclass(frozen=True)
class _Outcome:
    """What one request produced: its trace status and the result text for the model."""

    status: str
    result: str


class _Rejected(Exception):
    def __init__(self, status: str, code: str, message: str) -> None:
        super().__init__(code)
        self.status = status
        self.code = code
        self.message = message


def _dump(
    model: BaseModel, *, exclude: set[str] | None = None, include: set[str] | None = None
) -> dict[str, Any]:
    return model.model_dump(mode="json", include=include, exclude={"id", *(exclude or set())})


def study_time(seconds: int) -> str:
    """Seconds as the website shows learning time (`formatStudyTime` of `apps/web`)."""
    minutes = int(seconds / 60 + 0.5)
    if minutes == 0:
        return "<1 min" if seconds > 0 else "0 min"
    if minutes < 60:
        return f"{minutes} min"
    hours, rest = divmod(minutes, 60)
    return f"{hours}h {rest}m" if rest else f"{hours}h"


#: Renamed time fields: a session's elapsed seconds are its logged time, not an event's length.
_TIME_KEYS: Final = {"duration_seconds": "time", "estimated_minutes": "estimated_time"}


def _times(value: Any) -> Any:
    """`value` with every logged `*_seconds` and estimated minutes as a formatted `*_time`."""
    if isinstance(value, list):
        return [_times(item) for item in value]
    if not isinstance(value, dict):
        return value
    timed: dict[str, Any] = {}
    for key, item in value.items():
        if key == "estimated_minutes":
            timed[_TIME_KEYS[key]] = None if item is None else study_time(item * 60)
        elif key.endswith("_seconds"):
            timed[_TIME_KEYS.get(key, key.removesuffix("_seconds") + "_time")] = study_time(item)
        else:
            timed[key] = _times(item)
    return timed


def _experiences(items: Sequence[PublicExperience]) -> list[_Record]:
    return [_record("experience", e.slug, f"{e.title}, {e.organization}", _dump(e)) for e in items]


def _project_summary(project: PublicProject) -> dict[str, Any]:
    return {**_dump(project, exclude={"case_study"}), "has_case_study": bool(project.case_study)}


def _projects(items: Sequence[PublicProject]) -> list[_Record]:
    return [_record("project", p.slug, p.name, _project_summary(p)) for p in items]


def _services(items: Sequence[PublicService]) -> list[_Record]:
    return [_record("service", s.slug, s.name, _dump(s)) for s in items]


def _explorations(items: Sequence[PublicExploration]) -> list[_Record]:
    return [_record("exploration", e.slug, e.name, _dump(e)) for e in items]


def _education(items: Sequence[PublicEducation]) -> list[_Record]:
    return [_record("education", e.slug, e.title, _dump(e)) for e in items]


def _focus(items: Sequence[PublicCurrentFocus]) -> list[_Record]:
    return [_record("current_focus", f.slug, f.title, _dump(f)) for f in items]


def _area(area: PublicRoadmapArea) -> _Record:
    """An area with its modules' progress; the modules' resources are the area detail's."""
    data = _times(_dump(area, exclude={"modules"}))
    data["modules"] = [
        _times(_dump(module, include={"slug", "name", "progress"})) for module in area.modules
    ]
    return _record("roadmap_area", area.slug, area.name, data)


def _roadmap(roadmap: PublicRoadmap) -> list[_Record]:
    summary = _record("roadmap", ROADMAP_ID, "AI Roadmap", _times(_dump(roadmap.summary)))
    return [summary, *(_area(area) for area in roadmap.areas)]


def _area_detail(area: PublicRoadmapArea) -> list[_Record]:
    modules = [
        _record(
            "roadmap_module",
            module.slug,
            module.name,
            {"area": area.slug, **_times(_dump(module))},
            area=area.slug,
        )
        for module in area.modules
    ]
    return [_area(area), *modules]


def _diary(days: Sequence[PublicDiaryDay]) -> list[_Record]:
    return [
        _record(
            "diary_day",
            day.date.isoformat(),
            f"Learning diary, {day.date.isoformat()}",
            _times(_dump(day)),
        )
        for day in days
    ]


def _statistics(statistics: PublicLearningStatistics) -> list[_Record]:
    data = _times(_dump(statistics))
    return [_record("statistics", STATISTICS_ID, "Learning statistics", data)]


def _books(items: Sequence[PublicBook]) -> list[_Record]:
    return [_record("book", b.slug, b.title, _times(_dump(b))) for b in items]


def _events(items: Sequence[PublicEvent]) -> list[_Record]:
    return [
        _record("event", e.slug, e.name, _times(_dump(e)), year=str(e.starts_on.year))
        for e in items
    ]


def profile_view(person: PublicPerson) -> dict[str, Any]:
    """The public profile projection `get_profile` gives the model: no identifier, e-mail or links.

    The AI service's profile capability returns the same projection, so both paths stay equal.
    """
    return person.model_dump(mode="json", exclude={"id", "email", "links"})


def _contact(person: PublicPerson) -> dict[str, Any]:
    return person.model_dump(mode="json", include={"name", "email", "links"})


#: The one slug argument of the tools that take one, and what the model must give.
_SLUG_ARGUMENT: Final[dict[ToolName, tuple[str, str]]] = {
    "get_project": ("slug", "Give one project slug and nothing else."),
    "get_roadmap_area": ("area", "Give one roadmap area slug and nothing else."),
}


def _arguments(tool: ToolName, arguments: Mapping[str, Any]) -> str | None:
    """The validated slug of `get_project` or `get_roadmap_area`, None for the other tools."""
    if tool in _SLUG_ARGUMENT:
        name, message = _SLUG_ARGUMENT[tool]
        if set(arguments) != {name} or not valid_slug(arguments[name]):
            raise _Rejected("invalid_arguments", "invalid_arguments", message)
        return str(arguments[name])
    if arguments:
        raise _Rejected("invalid_arguments", "invalid_arguments", "This tool takes no arguments.")
    return None


class Tools:
    """The read tools of one execution and the evidence they returned."""

    def __init__(
        self,
        content: ContentReader,
        *,
        tracer: Tracer,
        deadline: Deadline,
        call_s: float,
        result_tokens: int,
    ) -> None:
        self._content = content
        self._tracer = tracer
        self._deadline = deadline
        self._call_s = call_s
        self._result_tokens = result_tokens
        self._reads: dict[tuple[str, ...], asyncio.Task[Any]] = {}
        self._slots = asyncio.Semaphore(MAX_CONCURRENT_READS)
        self._context_used = 0
        self.evidence: list[Evidence] = []

    def by_ref(self) -> dict[str, Evidence]:
        return {item.ref: item for item in self.evidence}

    def has(self, kind: SourceKind) -> bool:
        return any(item.kind == kind for item in self.evidence)

    def contact_card(self) -> ContactCard | None:
        """The card built from this turn's trusted contact evidence, if it was read."""
        for item in self.evidence:
            if item.kind == "contact":
                return ContactCard(
                    name=str(item.data["name"]),
                    email=item.data.get("email"),
                    links=[ContactLink.model_validate(link) for link in item.data["links"]],
                )
        return None

    def blocks(self, refs: Sequence[str]) -> list[Block]:
        """Typed blocks of the cited experiences, services, explorations and roadmap areas or
        modules, in citation order.

        Every field comes from the evidence record; a record that does not fit the block contract
        gets no block rather than a shortened one.
        """
        evidence = self.by_ref()
        built: list[Block] = []
        for ref in dict.fromkeys(refs):
            item = evidence.get(ref)
            if item is None or len(built) == MAX_BLOCKS:
                continue
            try:
                block = _block(item)
            except (ValidationError, KeyError):
                continue
            if block is not None:
                built.append(block)
        return built

    async def call(self, name: str, arguments: Mapping[str, Any]) -> str:
        """Runs one tool request of the model; returns the tool result text for the model."""
        [result] = await self.call_many([(name, arguments)])
        return result

    async def call_many(self, requests: Sequence[tuple[str, Mapping[str, Any]]]) -> list[str]:
        """Runs one decision's tool requests; returns their result texts in request order.

        Arguments are validated before any read; the reads run concurrently within the cap; the
        results are admitted (size, context, evidence) and traced in request order.
        """
        started = self._tracer.start()
        planned: list[tuple[str, ToolName | None, str | None, _Rejected | None]] = []
        for name, arguments in requests:
            tool = _tool(name)
            if tool is None:
                planned.append((name, None, None, None))
                continue
            try:
                planned.append((name, tool, _arguments(tool, arguments), None))
            except _Rejected as invalid:
                planned.append((name, tool, None, invalid))
        fetched = await asyncio.gather(
            *(
                self._fetch(tool, slug)
                for _, tool, slug, rejected in planned
                if tool is not None and rejected is None
            ),
            return_exceptions=True,
        )
        reads = iter(fetched)
        results: list[str] = []
        for _name, tool, slug, rejected in planned:
            if tool is None:
                self._tracer.finish("guard.tool_rejected", "rejected", started)
                results.append(_error("not_available", "This tool is not available."))
                continue
            if rejected is not None:
                outcome = _Outcome(rejected.status, _error(rejected.code, rejected.message))
            else:
                outcome = self._admit(tool, slug, next(reads), model=True)
            self._tracer.finish(f"tool.{tool}", outcome.status, started)
            results.append(outcome.result)
        return results

    async def ensure(self, tool: ToolName) -> bool:
        """A deterministic read outside the model loop (the trusted contact card)."""
        started = self._tracer.start()
        try:
            read: Any = await self._fetch(tool, None)
        except Exception as error:  # admitted below like any failed read
            read = error
        outcome = self._admit(tool, None, read, model=False)
        self._tracer.finish(f"tool.{tool}", outcome.status, started)
        return outcome.status == "ok"

    async def close(self) -> None:
        """Cancels the reads still in flight; a stopped execution leaves no read running.

        A read is shared between requests through a shielded task, so cancelling the waiting
        graph does not cancel the read itself; the execution calls this once it ends.
        """
        pending = [task for task in self._reads.values() if not task.done()]
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)

    # --- Reads ------------------------------------------------------------------------------------

    async def _fetch(self, tool: ToolName, slug: str | None) -> Any:
        key, read = self._read(tool, slug)
        task = self._reads.get(key)
        if task is None:
            task = asyncio.ensure_future(self._bounded(read))
            self._reads[key] = task
        try:
            return await asyncio.shield(task)
        except Exception:
            # A failed read is not cached: a later request may try it again.
            if self._reads.get(key) is task:
                del self._reads[key]
            raise

    def _read(
        self, tool: ToolName, slug: str | None
    ) -> tuple[tuple[str, ...], Callable[[], Awaitable[Any]]]:
        return _reader(self._content, tool, slug)

    async def _bounded(self, read: Callable[[], Awaitable[Any]]) -> Any:
        async with self._slots:
            timeout = self._deadline.bounded(self._call_s)
            try:
                async with asyncio.timeout(timeout):
                    return await read()
            except TimeoutError as error:
                raise ContentUnavailableError("the read timed out") from error

    # --- Admission --------------------------------------------------------------------------------

    def _admit(self, tool: ToolName, slug: str | None, read: Any, *, model: bool) -> _Outcome:
        # A withheld result leaves no evidence behind: the ledger is restored on rejection.
        ledger = list(self.evidence)
        try:
            if isinstance(read, ContentNotFoundError):
                raise _Rejected("not_found", "not_found", "No such record is published.")
            if isinstance(read, (ContentUnavailableError, ValueError)):
                raise _Rejected("error", "unavailable", "The published data could not be read.")
            if isinstance(read, BaseException):
                raise read
            if tool in _PERSON_KIND:
                payload = self._person(tool, read)
            else:
                payload = self._records(tool, _records(tool, read))
            if model:
                tokens = json_tokens(payload)
                if self._context_used + tokens > CONTEXT_TOKENS:
                    raise _Rejected(
                        "context_full",
                        "context_full",
                        "No more published data fits this answer; answer with what you have.",
                    )
                self._context_used += tokens
        except _Rejected as rejected:
            self.evidence = ledger
            return _Outcome(rejected.status, _error(rejected.code, rejected.message))
        return _Outcome("ok", json.dumps(payload, ensure_ascii=False))

    def _person(self, tool: ToolName, person: PublicPerson) -> dict[str, Any]:
        kind = _PERSON_KIND[tool]
        data = profile_view(person) if kind == "profile" else _contact(person)
        existing = next((item for item in self.evidence if item.kind == kind), None)
        if existing is None:
            if json_tokens(data) > self._result_tokens:
                raise _Rejected("too_large", "too_large", "The result is too large to use.")
            existing = self._record(tool, kind, person.id, person.name, CANONICAL_HREF[kind], data)
        return {"ref": existing.ref, "kind": kind, "data": existing.data}

    def _records(self, tool: ToolName, records: list[_Record]) -> dict[str, Any]:
        if len(records) > MAX_RECORDS:
            raise _Rejected("too_large", "too_large", "The result has too many records to use.")
        if len({(record.kind, record.slug) for record in records}) != len(records):
            raise _Rejected("error", "unavailable", "The published data could not be read.")
        if json_tokens([record.data for record in records]) > self._result_tokens:
            raise _Rejected("too_large", "too_large", "The result is too large to use.")
        items: list[dict[str, Any]] = []
        for record in records:
            evidence = self._evidence(tool, record)
            items.append({"ref": evidence.ref, "kind": record.kind, "data": evidence.data})
        return {"ok": True, "records": items}

    def _evidence(self, tool: ToolName, record: _Record) -> Evidence:
        for index, item in enumerate(self.evidence):
            if item.kind == record.kind and item.record_id == record.slug:
                # The project detail supersedes its list summary under the same ref.
                if tool == "get_project" and item.data != record.data:
                    item = item.model_copy(update={"tool": tool, "data": record.data})
                    self.evidence[index] = item
                return item
        return self._record(tool, record.kind, record.slug, record.title, record.href, record.data)

    def _record(
        self,
        tool: ToolName,
        kind: SourceKind,
        record_id: str,
        title: str,
        href: str,
        data: dict[str, Any],
    ) -> Evidence:
        evidence = Evidence(
            ref=f"src-{len(self.evidence) + 1}",
            tool=tool,
            kind=kind,
            record_id=record_id,
            title=title,
            href=href,
            data=data,
        )
        self.evidence.append(evidence)
        return evidence


def _reader(
    content: ContentReader, tool: ToolName, slug: str | None
) -> tuple[tuple[str, ...], Callable[[], Awaitable[Any]]]:
    if tool in ("get_profile", "get_contact"):
        return ("person",), content.read_person
    if tool == "get_project" and slug is not None:
        return ("project", slug), lambda: content.read_project(slug)
    if tool == "get_roadmap_area" and slug is not None:
        return ("roadmap_area", slug), lambda: content.read_roadmap_area(slug)
    reads: dict[str, Callable[[], Awaitable[Any]]] = {
        "list_experiences": content.read_experiences,
        "list_projects": content.read_projects,
        "list_services": content.read_services,
        "list_explorations": content.read_explorations,
        "list_education": content.read_education,
        "list_current_focus": content.read_current_focus,
        "get_roadmap": content.read_roadmap,
        "get_learning_diary": content.read_diary,
        "get_learning_statistics": content.read_statistics,
        "list_books": content.read_books,
        "list_events": content.read_events,
    }
    return (tool,), reads[tool]


def _tool(name: str) -> ToolName | None:
    for tool in TOOLS:
        if tool == name:
            return tool
    return None


def _records(tool: ToolName, read: Any) -> list[_Record]:
    if tool == "get_project":
        return [_record("project", read.slug, read.name, _dump(read))]
    projections: dict[str, Callable[[Any], list[_Record]]] = {
        "list_experiences": _experiences,
        "list_projects": _projects,
        "list_services": _services,
        "list_explorations": _explorations,
        "list_education": _education,
        "list_current_focus": _focus,
        "get_roadmap": _roadmap,
        "get_roadmap_area": _area_detail,
        "get_learning_diary": _diary,
        "get_learning_statistics": _statistics,
        "list_books": _books,
        "list_events": _events,
    }
    return projections[tool](read)


def _block(item: Evidence) -> Block | None:
    data = item.data
    if item.kind == "experience":
        return ExperienceCard(
            title=data["title"],
            organization=data["organization"],
            started_on=data["started_on"],
            ended_on=data["ended_on"],
            summary=data["summary"],
            technologies=data["technologies"],
            href=item.href,
        )
    if item.kind == "service":
        return ServiceCard(title=data["name"], summary=data["summary"], href=item.href)
    if item.kind == "exploration":
        return ExplorationCard(
            title=data["name"], summary=data["summary"], status=data["status"], href=item.href
        )
    if item.kind in ("roadmap_area", "roadmap_module"):
        return RoadmapCard(title=data["name"], summary=data["description"], href=item.href)
    return None


def _error(code: str, message: str) -> str:
    return json.dumps({"error": code, "message": message})


# --- Read capabilities ----------------------------------------------------------------------------

#: The read capabilities: every read tool but the contact read, whose e-mail and links reach a
#: visitor only as the chat's trusted contact card, and the technology catalogue, which no model
#: tool reads (the model sees technologies inside the career records).
CapabilityName = Literal[
    "get_profile",
    "list_experiences",
    "list_projects",
    "get_project",
    "list_services",
    "list_explorations",
    "list_education",
    "list_current_focus",
    "get_roadmap",
    "get_roadmap_area",
    "get_learning_diary",
    "get_learning_statistics",
    "list_books",
    "list_events",
    "list_technologies",
]
#: The kind of a capability record: a source kind, or a technology of the catalogue.
RecordKind = Literal[SourceKind, "technology"]
READ_CAPABILITIES: Final[tuple[CapabilityName, ...]] = get_args(CapabilityName)
#: The canonical site section of the technology catalogue.
TECHNOLOGY_HREF: Final = "/experience#technologies-heading"
_TECHNOLOGY_SPEC: Final[dict[str, Any]] = {
    "name": "list_technologies",
    "description": (
        "Read the published technology catalogue: each technology's name, its tier (primary or"
        " secondary) and, for a primary technology, its group (core or AI engineering focus)."
    ),
    "input_schema": _NO_ARGUMENTS,
}
#: The name, description and input schema of each read capability, in `READ_CAPABILITIES` order;
#: a capability that is a model tool keeps the tool's own spec.
READ_CAPABILITY_SPECS: Final[tuple[dict[str, Any], ...]] = tuple(
    next(spec for spec in (*TOOL_SPECS, _TECHNOLOGY_SPEC) if spec["name"] == name)
    for name in READ_CAPABILITIES
)
#: Records one capability page carries by default.
PAGE_RECORDS: Final = 10
#: Records one capability read may list across all its pages; a longer list is refused.
MAX_LISTED_RECORDS: Final = 300
#: Tokens one capability page may carry (`ExecutionLimits.tool_result_tokens`).
PAGE_TOKENS: Final = 5000


class ToolNotAvailableError(LookupError):
    """The name is not one of the read capabilities; nothing was read."""


class InvalidToolArgumentsError(ValueError):
    """The arguments or the page are not ones the capability takes; nothing was read."""


class ToolResultTooLargeError(Exception):
    """The result exceeds the record or token bounds; it is refused, never truncated."""


@dataclass(frozen=True)
class ToolRecord:
    """One projected record: its kind, its own identifier, title and canonical site path."""

    kind: RecordKind
    record_id: str
    title: str
    href: str
    data: dict[str, Any]


@dataclass(frozen=True)
class ToolPage:
    capability: CapabilityName
    records: tuple[ToolRecord, ...]
    page: int
    page_count: int


async def read_tool(
    content: ContentReader,
    name: str,
    arguments: Mapping[str, Any],
    *,
    page: int = 1,
    page_records: int = PAGE_RECORDS,
    page_tokens: int = PAGE_TOKENS,
) -> ToolPage:
    """One page of a read capability: the in-process tool's projection of the same read.

    The name and arguments are validated before any read, with the tools' own rules; the records
    are the projections `Tools` gives the model, in the same order. `list_technologies`, which no
    model tool reads, takes no arguments and lists the catalogue in its published order, each
    record without its identifier or logo. Raises `ToolNotAvailableError`,
    `InvalidToolArgumentsError` (also for a page outside the result), `ToolResultTooLargeError`,
    `ContentNotFoundError` or `ContentUnavailableError`.
    """
    capability = next((item for item in READ_CAPABILITIES if item == name), None)
    if capability is None:
        raise ToolNotAvailableError(name)
    if capability == "list_technologies":
        if arguments:
            raise InvalidToolArgumentsError("This capability takes no arguments.")
        slug = None
    else:
        try:
            slug = _arguments(capability, arguments)
        except _Rejected as rejected:
            raise InvalidToolArgumentsError(rejected.message) from None
    if page < 1 or page_records < 1:
        raise InvalidToolArgumentsError("The page must be a positive number.")
    records = await _capability_records(content, capability, slug)
    if len({(record.kind, record.record_id) for record in records}) != len(records):
        raise ContentUnavailableError("the published data has duplicate records")
    if len(records) > MAX_LISTED_RECORDS:
        raise ToolResultTooLargeError("the result has too many records")
    page_count = max(1, -(-len(records) // page_records))
    if page > page_count:
        raise InvalidToolArgumentsError("There is no such page.")
    selected = tuple(records[(page - 1) * page_records : page * page_records])
    if json_tokens([record.data for record in selected]) > page_tokens:
        raise ToolResultTooLargeError("the page is too large")
    return ToolPage(capability, selected, page, page_count)


async def _capability_records(
    content: ContentReader, capability: CapabilityName, slug: str | None
) -> list[ToolRecord]:
    if capability == "list_technologies":
        technologies: list[PublicTechnology] = await content.read_technologies()
        return [
            ToolRecord("technology", t.slug, t.name, TECHNOLOGY_HREF, _dump(t))
            for t in technologies
        ]
    _, read = _reader(content, capability, slug)
    value = await read()
    if capability == "get_profile":
        # The profile view omits the person's identifier; the record is the one profile.
        return [
            ToolRecord(
                "profile", "profile", value.name, CANONICAL_HREF["profile"], profile_view(value)
            )
        ]
    return [
        ToolRecord(record.kind, record.slug, record.title, record.href, record.data)
        for record in _records(capability, value)
    ]
