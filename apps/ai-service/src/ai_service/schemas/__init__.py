"""The service's wire bodies, in the API contract's camelCase shapes.

`GenerationRequest` is what the API dispatches (`POST /internal/v1/generations`); it forbids any
field it does not name, so no request can choose a model scenario or a limit. `ResultReport` is the
one result this service reconciles: a validating guard of `ChatGenerationResult` in the API
document, tied to it field by field by `tests/test_contract.py`; the control client sends it as the
generated model. The grant claim's answer has no local copy: it is the generated `ChatGrantClaimed`.

`CompactionRequest` is the API's dispatch of one compaction of a conversation's working context
(`POST /internal/v1/compactions`), as strict as the generation request; `CompactionReport` is its
one result, a validating guard of `ChatCompactionResult` in the API document, tied to it the same
way. `WireSummary` is the agent's validated `ContextSummary` in camelCase: the API stores it as
private conversation state and sends it back with the next generation or compaction, never to a
visitor; it is untrusted history and the agent re-validates it on every request.
"""

from __future__ import annotations

import datetime
import uuid
from typing import Annotated, Any, Literal

from llm_agent import CapabilityName, RecordKind
from llm_agent.schemas.responses import SourceKind
from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)
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
#: The agent's summary bounds (`llm_agent.ContextSummary`, `SUMMARY_TOKEN_CAP`).
MAX_SUMMARY_LINE_CHARS = 300
MAX_SUMMARY_TOKENS = 1500
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


SummaryLine = Annotated[str, StringConstraints(min_length=1, max_length=MAX_SUMMARY_LINE_CHARS)]


class WireReference(_Body):
    """A record an earlier answer cited, with the agent's source kind: a pointer, never evidence."""

    kind: SourceKind
    record_id: Annotated[str, StringConstraints(min_length=1, max_length=128)]
    title: Annotated[str, StringConstraints(max_length=200)] = ""


class WireSummary(_Body):
    """The installed summary of a working context (`llm_agent.ContextSummary`); untrusted."""

    language: Language
    goals: list[SummaryLine] = Field(default_factory=list, max_length=5)
    open_questions: list[SummaryLine] = Field(default_factory=list, max_length=5)
    covered: list[SummaryLine] = Field(default_factory=list, max_length=8)
    visitor_claims: list[SummaryLine] = Field(default_factory=list, max_length=5)
    references: list[WireReference] = Field(default_factory=list, max_length=12)


class GenerationRequest(_Body):
    """One admitted question the API dispatches with its one-use grant and its deadline."""

    operation_id: uuid.UUID
    grant: Grant
    question: Annotated[Text, StringConstraints(max_length=MAX_QUESTION_CHARS)]
    history: list[HistoryExchange] = Field(default_factory=list, max_length=MAX_HISTORY_EXCHANGES)
    #: The summary installed before `history` by a compaction; None when there is none.
    summary: WireSummary | None = None
    #: The visitor's Europe/Prague calendar day.
    today: datetime.date
    #: The absolute deadline of the operation; nothing in this service extends it.
    deadline_at: AwareDatetime
    context_revision: int = Field(ge=0)
    model: Annotated[str, StringConstraints(min_length=1, max_length=100)]
    #: The main reasoning effort bound at admission; it must be this agent's.
    effort: Annotated[str, StringConstraints(min_length=1, max_length=100)]
    pricing_version: Annotated[str, StringConstraints(min_length=1, max_length=100)]
    allowance_usd: float = Field(gt=0, le=MAX_ALLOWANCE_USD)


class CompactionRequest(_Body):
    """One admitted compaction the API dispatches: the working context and the bound terms.

    `summary` and `exchanges` are the conversation's current working context at
    `context_revision`, oldest exchange first; the API installs a result only at that revision.
    """

    operation_id: uuid.UUID
    grant: Grant
    summary: WireSummary | None = None
    exchanges: list[HistoryExchange] = Field(
        default_factory=list, max_length=MAX_HISTORY_EXCHANGES
    )
    deadline_at: AwareDatetime
    context_revision: int = Field(ge=0)
    model: Annotated[str, StringConstraints(min_length=1, max_length=100)]
    effort: Annotated[str, StringConstraints(min_length=1, max_length=100)]
    pricing_version: Annotated[str, StringConstraints(min_length=1, max_length=100)]
    allowance_usd: float = Field(gt=0, le=MAX_ALLOWANCE_USD)


class Accepted(_Body):
    accepted: Literal[True] = True


class Problem(_Body):
    """A refusal with a stable code and nothing else."""

    code: Literal[
        "busy",
        "unauthorized",
        "version_mismatch",
        "unavailable",
        "not_found",
        "invalid_arguments",
        "rate_limited",
    ]


#: The most pages one capability read may have (`llm_agent`'s listed-record and page bounds).
MAX_CAPABILITY_PAGE = 30


class CapabilityRecord(_Body):
    """One projected record, exactly as the in-process tool gives it to the model."""

    kind: RecordKind
    id: Annotated[str, StringConstraints(min_length=1, max_length=200)]
    title: Annotated[str, StringConstraints(max_length=500)]
    href: Annotated[str, StringConstraints(pattern=SITE_PATH_PATTERN, max_length=500)]
    data: dict[str, Any]


class CapabilityPage(_Body):
    """One page of a read capability; `page_count` pages hold every record, in order."""

    capability: CapabilityName
    page: Annotated[int, Field(ge=1, le=MAX_CAPABILITY_PAGE)]
    page_count: Annotated[int, Field(ge=1, le=MAX_CAPABILITY_PAGE)]
    records: list[CapabilityRecord]


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


class ReportContext(_Body):
    """The last main model call's serialized input: the estimate, the provider's count, the cap."""

    estimated_input_tokens: int = Field(ge=0)
    reported_input_tokens: int | None = Field(ge=0)
    cap_tokens: int = Field(gt=0)


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
    #: `None` when no main model call was measured.
    context: ReportContext | None = None


CompactionOutcome = Literal["compacted", "unchanged", "failed"]


class CompactionReport(_Body):
    """The one result of a compaction; the API installs `summary` only when it is `compacted`.

    On `compacted`, `summary` is the new summary, `kept` how many of the dispatched exchanges,
    newest first, stay verbatim after it, and `next_input_tokens` the estimate of the working
    context the next question carries (summary and kept exchanges; never the question, the
    instructions or a tool result). On `unchanged` and `failed` nothing is installed: `summary` is
    None, `summary_tokens` 0, and `next_input_tokens` the current context's estimate when the
    agent measured it, None otherwise.
    """

    grant: Grant
    outcome: CompactionOutcome
    reason: Annotated[str, StringConstraints(min_length=1, max_length=64)] | None
    summary: WireSummary | None
    kept: int = Field(ge=0, le=MAX_HISTORY_EXCHANGES)
    summary_tokens: int = Field(ge=0, le=MAX_SUMMARY_TOKENS)
    next_input_tokens: int | None = Field(ge=0)
    usage: ReportUsage
    versions: dict[str, str] = Field(max_length=MAX_VERSIONS)
    latency_ms: int = Field(ge=0)

    @model_validator(mode="after")
    def _installs_only_a_compacted_summary(self) -> CompactionReport:
        if self.outcome == "compacted":
            if self.summary is None or self.reason is not None or self.next_input_tokens is None:
                raise ValueError("a compacted result has a summary, no reason and an estimate")
        elif self.summary is not None or self.summary_tokens != 0 or self.reason is None:
            raise ValueError("only a compacted result carries a summary; others have a reason")
        return self
