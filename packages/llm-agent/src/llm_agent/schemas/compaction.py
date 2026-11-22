"""What one compaction of a working context returns (`ChatAgent.compact`)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from llm_agent.schemas.requests import ContextSummary
from llm_agent.schemas.responses import Span, Usage, Versions

CompactionOutcome = Literal["compacted", "unchanged", "failed"]


class CompactionResult(BaseModel):
    """What one compaction returns; the caller installs `summary` only when it is `compacted`.

    `kept` is the number of newest exchanges that stay verbatim after `summary`: on `compacted`
    the older ones are folded into it, otherwise it is every exchange and `summary` is the prior
    one unchanged. `next_input_tokens` estimates the working context the next question would
    carry (summary and kept exchanges); it excludes the question, instructions and tool results.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    outcome: CompactionOutcome
    #: Why nothing was installed: `nothing_to_compact`, `invalid_summary`, `model_unavailable`,
    #: `cancelled`, `deadline` or a limit; None when compacted.
    reason: str | None
    summary: ContextSummary | None
    kept: int = Field(ge=0)
    summary_tokens: int = Field(ge=0)
    next_input_tokens: int = Field(ge=0)
    usage: Usage
    trace: list[Span]
    versions: Versions
    execution_id: str | None = None
    trace_id: str | None = None
