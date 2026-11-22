"""The service's wire bodies, in the API contract's camelCase shapes.

`GenerationRequest` is what the API dispatches (`POST /internal/v1/generations`); it forbids any
field it does not name, so no request can choose a model scenario or a limit. `ResultReport` is the
one result this service reconciles: a validating guard of `ChatGenerationResult` in the API
document, tied to it field by field by `tests/test_contract.py`; the control client sends it as the
generated model. The grant claim's answer has no local copy: it is the generated `ChatGrantClaimed`.
"""

from __future__ import annotations

import datetime
import uuid
from typing import Annotated, Any, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints
from pydantic.alias_generators import to_camel

#: The contract's limits (`packages/contracts/src/modules/chat`).
MAX_QUESTION_CHARS = 1000
MAX_ANSWER_CHARS = 32000
MAX_GRANT_CHARS = 200
MAX_HISTORY_EXCHANGES = 6
MAX_SOURCES = 8
MAX_BLOCKS = 3
MAX_VERSIONS = 20
#: The per-operation allowance the API reserves; a request can never raise it.
MAX_ALLOWANCE_USD = 0.02
#: A site-relative path: one leading slash (never `//`), no whitespace, backslash or control.
SITE_PATH_PATTERN = r"^/(?:[^/\s\\\x00-\x1f\x7f][^\s\\\x00-\x1f\x7f]*)?$"

ContractKind = Literal[
    "person",
    "experience",
    "project",
    "exploration",
    "service",
    "technology_group",
    "roadmap_item",
]
Outcome = Literal[
    "answered", "insufficient_evidence", "refused", "unavailable", "cancelled", "limit_reached"
]
Language = Literal["en", "cs"]

Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
Grant = Annotated[str, StringConstraints(min_length=1, max_length=MAX_GRANT_CHARS)]


class _Body(BaseModel):
    model_config = ConfigDict(
        extra="forbid", frozen=True, alias_generator=to_camel, populate_by_name=True
    )


class HistorySource(_Body):
    kind: ContractKind
    record_id: Annotated[str, StringConstraints(min_length=1, max_length=200)]
    title: Annotated[str, StringConstraints(max_length=200)]


class HistoryExchange(_Body):
    """One earlier answered exchange, as the API projects it; untrusted conversation data."""

    question: Annotated[Text, StringConstraints(max_length=MAX_QUESTION_CHARS)]
    answer: Annotated[Text, StringConstraints(max_length=MAX_ANSWER_CHARS)]
    language: Language
    sources: list[HistorySource] = Field(default_factory=list, max_length=MAX_SOURCES)


class GenerationRequest(_Body):
    """One admitted question the API dispatches with its one-use grant and its deadline."""

    operation_id: uuid.UUID
    grant: Grant
    question: Annotated[Text, StringConstraints(max_length=MAX_QUESTION_CHARS)]
    history: list[HistoryExchange] = Field(default_factory=list, max_length=MAX_HISTORY_EXCHANGES)
    #: The visitor's Europe/Prague calendar day.
    today: datetime.date
    #: The absolute deadline of the operation; nothing in this service extends it.
    deadline_at: AwareDatetime
    context_revision: int = Field(ge=0)
    model: Annotated[str, StringConstraints(min_length=1, max_length=100)]
    pricing_version: Annotated[str, StringConstraints(min_length=1, max_length=100)]
    allowance_usd: float = Field(gt=0, le=MAX_ALLOWANCE_USD)


class Accepted(_Body):
    accepted: Literal[True] = True


class Problem(_Body):
    """A refusal with a stable code and nothing else."""

    code: Literal["busy", "unauthorized", "version_mismatch", "unavailable"]


class ReportRecord(_Body):
    kind: ContractKind
    id: Annotated[str, StringConstraints(min_length=1, max_length=200)]


class ReportSource(_Body):
    record: ReportRecord
    title: Annotated[Text, StringConstraints(max_length=200)]
    href: Annotated[str, StringConstraints(max_length=2048, pattern=SITE_PATH_PATTERN)]


class ReportUsage(_Body):
    cost_usd: float = Field(ge=0)
    cost_uncertain: bool
    input_tokens: int = Field(ge=0)
    output_tokens: int = Field(ge=0)
    model_attempts: int = Field(ge=0)


class ResultReport(_Body):
    """The one result of a generation, already approved by the agent's Output Guard."""

    grant: Grant
    outcome: Outcome
    reason: Annotated[str, StringConstraints(min_length=1, max_length=64)] | None
    language: Language
    text: Annotated[str, StringConstraints(max_length=MAX_ANSWER_CHARS)]
    #: Typed blocks in the contract's camelCase shape (`ChatBlock`).
    blocks: list[dict[str, Any]] = Field(max_length=MAX_BLOCKS)
    sources: list[ReportSource] = Field(max_length=MAX_SOURCES)
    related: list[dict[str, str]] = Field(max_length=2)
    usage: ReportUsage
    versions: dict[str, str] = Field(max_length=MAX_VERSIONS)
    latency_ms: int = Field(ge=0)
