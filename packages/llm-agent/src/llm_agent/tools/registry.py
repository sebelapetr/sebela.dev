"""The allowlisted read tools, their execution and this turn's evidence ledger.

The tools are the public profile and contact reads and the career reads: experiences, projects,
one project's detail, services, explorations and education. A requested tool outside the allowlist
is rejected and never executed; arguments are validated before any read (only `get_project` takes
one, a bounded slug). Every result is projected (no ids, no outside URLs), checked against the
record and token caps (rejected, never truncated), checked against the turn's total tool context
and recorded as evidence with a turn-local ref before it reaches the model.

Each read runs at most once per execution; at most `MAX_CONCURRENT_READS` independent reads run at
once. Results, evidence refs and trace spans follow the order of the model's requests, not the
order the reads finish in. Each record keeps its own identity (its slug) and canonical site link,
so a project cited after listing an experience is still the project's own source.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Final

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
    PublicEducation,
    PublicExperience,
    PublicExploration,
    PublicPerson,
    PublicProject,
    PublicService,
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
)

_KIND: Final[dict[ToolName, SourceKind]] = {
    "get_profile": "profile",
    "get_contact": "contact",
    "list_experiences": "experience",
    "list_projects": "project",
    "get_project": "project",
    "list_services": "service",
    "list_explorations": "exploration",
    "list_education": "education",
}
#: The canonical site page of the profile and contact sources.
CANONICAL_HREF: Final[dict[SourceKind, str]] = {"profile": "/", "contact": "/#contact"}
#: The canonical site page of a record of each career kind, by its slug.
RECORD_HREF: Final[dict[SourceKind, str]] = {
    "experience": "/experience#experience-{slug}",
    "project": "/experience#project-{slug}",
    "exploration": "/experience#exploration-{slug}",
    "service": "/services#service-{slug}",
    "education": "/experience#education-heading",
}


@dataclass(frozen=True)
class _Record:
    slug: str
    title: str
    data: dict[str, Any]


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


def _dump(model: BaseModel, *, exclude: set[str] | None = None) -> dict[str, Any]:
    return model.model_dump(mode="json", exclude={"id", *(exclude or set())})


def _experiences(items: Sequence[PublicExperience]) -> list[_Record]:
    return [_Record(e.slug, f"{e.title}, {e.organization}", _dump(e)) for e in items]


def _project_summary(project: PublicProject) -> dict[str, Any]:
    return {**_dump(project, exclude={"case_study"}), "has_case_study": bool(project.case_study)}


def _projects(items: Sequence[PublicProject]) -> list[_Record]:
    return [_Record(p.slug, p.name, _project_summary(p)) for p in items]


def _services(items: Sequence[PublicService]) -> list[_Record]:
    return [_Record(s.slug, s.name, _dump(s)) for s in items]


def _explorations(items: Sequence[PublicExploration]) -> list[_Record]:
    return [_Record(e.slug, e.name, _dump(e)) for e in items]


def _education(items: Sequence[PublicEducation]) -> list[_Record]:
    return [_Record(e.slug, e.title, _dump(e)) for e in items]


def _profile(person: PublicPerson) -> dict[str, Any]:
    return person.model_dump(mode="json", exclude={"id", "email", "links"})


def _contact(person: PublicPerson) -> dict[str, Any]:
    return person.model_dump(mode="json", include={"name", "email", "links"})


def _arguments(tool: ToolName, arguments: Mapping[str, Any]) -> str | None:
    """The validated slug of `get_project`, None for the tools without arguments."""
    if tool == "get_project":
        if set(arguments) != {"slug"} or not valid_slug(arguments["slug"]):
            raise _Rejected(
                "invalid_arguments", "invalid_arguments", "Give one project slug and nothing else."
            )
        return str(arguments["slug"])
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
        """Typed blocks of the cited experiences, services and explorations, in citation order.

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
        content = self._content
        if tool in ("get_profile", "get_contact"):
            return ("person",), content.read_person
        if tool == "get_project" and slug is not None:
            return ("project", slug), lambda: content.read_project(slug)
        reads: dict[str, Callable[[], Awaitable[Any]]] = {
            "list_experiences": content.read_experiences,
            "list_projects": content.read_projects,
            "list_services": content.read_services,
            "list_explorations": content.read_explorations,
            "list_education": content.read_education,
        }
        return (tool,), reads[tool]

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
            kind = _KIND[tool]
            if kind in ("profile", "contact"):
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
        kind = _KIND[tool]
        data = _profile(person) if kind == "profile" else _contact(person)
        existing = next((item for item in self.evidence if item.kind == kind), None)
        if existing is None:
            if json_tokens(data) > self._result_tokens:
                raise _Rejected("too_large", "too_large", "The result is too large to use.")
            existing = self._record(tool, kind, person.id, person.name, CANONICAL_HREF[kind], data)
        return {"ref": existing.ref, "kind": kind, "data": existing.data}

    def _records(self, tool: ToolName, records: list[_Record]) -> dict[str, Any]:
        kind = _KIND[tool]
        if len(records) > MAX_RECORDS:
            raise _Rejected("too_large", "too_large", "The result has too many records to use.")
        if len({record.slug for record in records}) != len(records):
            raise _Rejected("error", "unavailable", "The published data could not be read.")
        if json_tokens([record.data for record in records]) > self._result_tokens:
            raise _Rejected("too_large", "too_large", "The result is too large to use.")
        items: list[dict[str, Any]] = []
        for record in records:
            evidence = self._evidence(tool, kind, record)
            items.append({"ref": evidence.ref, "kind": kind, "data": evidence.data})
        return {"ok": True, "kind": kind, "records": items}

    def _evidence(self, tool: ToolName, kind: SourceKind, record: _Record) -> Evidence:
        for index, item in enumerate(self.evidence):
            if item.kind == kind and item.record_id == record.slug:
                # The project detail supersedes its list summary under the same ref.
                if tool == "get_project" and item.data != record.data:
                    item = item.model_copy(update={"tool": tool, "data": record.data})
                    self.evidence[index] = item
                return item
        href = RECORD_HREF[kind].format(slug=record.slug)
        return self._record(tool, kind, record.slug, record.title, href, record.data)

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


def _tool(name: str) -> ToolName | None:
    for tool in _KIND:
        if tool == name:
            return tool
    return None


def _records(tool: ToolName, read: Any) -> list[_Record]:
    if tool == "get_project":
        return [_Record(read.slug, read.name, _dump(read))]
    projections: dict[str, Callable[[Any], list[_Record]]] = {
        "list_experiences": _experiences,
        "list_projects": _projects,
        "list_services": _services,
        "list_explorations": _explorations,
        "list_education": _education,
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
    return None


def _error(code: str, message: str) -> str:
    return json.dumps({"error": code, "message": message})
