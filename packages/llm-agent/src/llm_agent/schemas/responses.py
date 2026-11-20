"""What an execution returns: only the approved response, its evidence, usage and trace.

A `ChatResult` is built by the Output Guard (or a fixed response) and never carries a draft the
guard did not approve.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Outcome = Literal[
    "answered", "insufficient_evidence", "refused", "unavailable", "cancelled", "limit_reached"
]
Language = Literal["en", "cs"]
SourceKind = Literal["profile", "contact"]
ToolName = Literal["get_profile", "get_contact"]


class _Frozen(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Source(_Frozen):
    """A citation of the answer: always one piece of this turn's evidence."""

    ref: str
    kind: SourceKind
    record_id: str
    title: str
    #: The canonical site page of the record, built from the kind, never from model text.
    href: str


class Evidence(_Frozen):
    """One allowlisted read of this turn, as the model saw it."""

    ref: str
    tool: ToolName
    kind: SourceKind
    record_id: str
    title: str
    href: str
    data: dict[str, Any]


class ContactLink(_Frozen):
    label: str
    url: str


class ContactCard(_Frozen):
    """Built from trusted contact data only; model text never fills it."""

    name: str
    email: str | None
    links: list[ContactLink]


class Usage(_Frozen):
    model_attempts: int = 0
    retries: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_creation_tokens: int = 0
    cost_usd: float = 0.0
    #: Some attempt's usage was not measured; its whole reservation is counted in `cost_usd`.
    cost_uncertain: bool = False


class Span(_Frozen):
    name: str
    status: str
    duration_ms: int
    attributes: dict[str, str | int | float | bool | None] = Field(default_factory=dict)


class Versions(_Frozen):
    """Everything that identifies the behaviour of the agent; stored with every eval record."""

    package: str
    pipeline: str
    security_model: str
    security_effort: str
    main_model: str
    main_effort: str
    security_prompt: str
    chat_prompt: str
    tools: str
    output_guard: str
    #: The fingerprint of every module of the package: guard rules, tool projections, settings.
    runtime: str
    #: The price list the subject's costs were computed with.
    pricing: str


class ChatResult(_Frozen):
    outcome: Outcome
    #: A stable machine-readable reason for every outcome except a plain answer.
    reason: str | None
    language: Language
    text: str
    contact: ContactCard | None
    sources: list[Source]
    evidence: list[Evidence]
    usage: Usage
    trace: list[Span]
    versions: Versions
    execution_id: str | None = None
    trace_id: str | None = None
