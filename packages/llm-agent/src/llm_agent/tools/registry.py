"""The allowlisted read tools, their execution and this turn's evidence ledger.

Only `get_profile` and `get_contact` exist. A requested tool outside the allowlist is rejected and
never executed; arguments are validated before execution (both tools take none); every result is
projected, size-checked and recorded as evidence with a turn-local ref before it reaches the model.
The person record is read at most once per execution.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Mapping
from typing import Any, Final

from llm_agent.context.tokens import json_tokens
from llm_agent.observability.tracing import Tracer
from llm_agent.reliability.timeouts import Deadline
from llm_agent.schemas import ContactCard, ContactLink, Evidence, SourceKind, ToolName
from llm_agent.tools.content import ContentReader, ContentUnavailableError, PublicPerson

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
)

_KIND: Final[dict[ToolName, SourceKind]] = {"get_profile": "profile", "get_contact": "contact"}
#: The canonical site page of each source kind.
CANONICAL_HREF: Final[dict[SourceKind, str]] = {"profile": "/", "contact": "/#contact"}


def _profile(person: PublicPerson) -> dict[str, Any]:
    return person.model_dump(mode="json", exclude={"id", "email", "links"})


def _contact(person: PublicPerson) -> dict[str, Any]:
    return person.model_dump(mode="json", include={"name", "email", "links"})


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
        self._person: PublicPerson | None = None
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

    async def call(self, name: str, arguments: Mapping[str, Any]) -> str:
        """Runs one tool request of the model; returns the tool result text for the model."""
        started = self._tracer.start()
        if name not in _KIND:
            self._tracer.finish("guard.tool_rejected", "rejected", started)
            return _error("not_available", "This tool is not available.")
        tool: ToolName = "get_profile" if name == "get_profile" else "get_contact"
        if arguments:
            self._tracer.finish(f"tool.{tool}", "invalid_arguments", started)
            return _error("invalid_arguments", "This tool takes no arguments.")
        status, result = await self._run(tool)
        self._tracer.finish(f"tool.{tool}", status, started)
        return result

    async def ensure(self, tool: ToolName) -> bool:
        """A deterministic read outside the model loop (the trusted contact card)."""
        started = self._tracer.start()
        status, _ = await self._run(tool)
        self._tracer.finish(f"tool.{tool}", status, started)
        return status == "ok"

    async def _run(self, tool: ToolName) -> tuple[str, str]:
        kind = _KIND[tool]
        try:
            person = await self._read_person()
        except ContentUnavailableError:
            return "error", _error("unavailable", "The published data could not be read.")
        data = _profile(person) if kind == "profile" else _contact(person)
        existing = next((item for item in self.evidence if item.kind == kind), None)
        if existing is None:
            if json_tokens(data) > self._result_tokens:
                return "too_large", _error("too_large", "The result is too large to use.")
            existing = Evidence(
                ref=f"src-{len(self.evidence) + 1}",
                tool=tool,
                kind=kind,
                record_id=person.id,
                title=person.name,
                href=CANONICAL_HREF[kind],
                data=data,
            )
            self.evidence.append(existing)
        payload = {"ref": existing.ref, "kind": kind, "data": existing.data}
        return "ok", json.dumps(payload, ensure_ascii=False)

    async def _read_person(self) -> PublicPerson:
        if self._person is None:
            timeout = self._deadline.bounded(self._call_s)
            try:
                async with asyncio.timeout(timeout):
                    self._person = await self._content.read_person()
            except TimeoutError as error:
                raise ContentUnavailableError("the read timed out") from error
        return self._person


def _error(code: str, message: str) -> str:
    return json.dumps({"error": code, "message": message})
