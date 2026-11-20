"""What a caller passes in: the question, execution identifiers and the limits it grants.

The defaults of `ExecutionLimits` are the owner-agreed initial limits (`.plan/06-llm-agent/prd.md`,
Initial execution limits). A caller may only tighten them; nothing the model writes changes them.
"""

from __future__ import annotations

import datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field

from llm_agent.schemas.responses import Language, SourceKind

#: A transport bound far above the question token cap: a longer question is malformed input,
#: a shorter one that exceeds the cap is a `limit_reached` result (`question_too_long`).
MAX_QUESTION_CHARS = 32000
#: Transport bounds of the caller-supplied conversation; the history caps select far less.
MAX_ANSWER_CHARS = 32000
MAX_HISTORY_EXCHANGES = 50
MAX_EXCHANGE_SOURCES = 12


def _not_blank(value: str) -> str:
    if not value.strip():
        raise ValueError("the text is empty")
    return value


NonBlank = Annotated[str, AfterValidator(_not_blank)]


class ExchangeSource(BaseModel):
    """A source shown with an earlier answer: a pointer for the follow-up, never evidence."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    kind: SourceKind
    record_id: str = Field(min_length=1, max_length=128)
    title: str = Field(max_length=200)


class ChatExchange(BaseModel):
    """One earlier visitor question and the approved answer the caller showed for it.

    It is untrusted conversation data: it carries no role, no instruction and no authority, and the
    agent re-reads anything it needs from the content tools.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    question: NonBlank = Field(max_length=MAX_QUESTION_CHARS)
    answer: NonBlank = Field(max_length=MAX_ANSWER_CHARS)
    language: Language
    sources: tuple[ExchangeSource, ...] = Field(default=(), max_length=MAX_EXCHANGE_SOURCES)


class ChatRequest(BaseModel):
    """One visitor turn. Identifiers are opaque and only label the trace."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    question: NonBlank = Field(max_length=MAX_QUESTION_CHARS)
    execution_id: str | None = Field(default=None, max_length=128)
    trace_id: str | None = Field(default=None, max_length=128)
    #: The trusted caller's Europe/Prague calendar day; relative windows ("this week") need it.
    #: Without it the agent knows no date and answers such questions without one.
    today: datetime.date | None = None
    #: The earlier exchanges of this conversation, oldest first. The caller stores the conversation;
    #: the agent selects the newest complete exchanges within the history caps.
    history: tuple[ChatExchange, ...] = Field(default=(), max_length=MAX_HISTORY_EXCHANGES)
    #: Seconds the caller already spent admitting this turn (queueing, rate checks). They count
    #: against the execution deadline, so admission can never extend it.
    admission_elapsed_s: float = Field(default=0.0, ge=0)


class ExecutionLimits(BaseModel):
    """Caps of one execution. Every field may be lowered, never raised above its default."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    #: The whole execution: admission, stages, tools, retries and the guard.
    deadline_s: float = Field(default=60.0, gt=0, le=60.0)
    security_attempt_s: float = Field(default=8.0, gt=0, le=8.0)
    main_attempt_s: float = Field(default=25.0, gt=0, le=25.0)
    tool_call_s: float = Field(default=5.0, gt=0, le=5.0)
    #: Additional model attempts for the whole execution, not per stage.
    retries: int = Field(default=1, ge=0, le=1)
    model_attempts: int = Field(default=5, ge=1, le=5)
    question_tokens: int = Field(default=1000, ge=1, le=1000)
    security_input_tokens: int = Field(default=4000, ge=1, le=4000)
    security_output_tokens: int = Field(default=768, ge=1, le=768)
    main_input_tokens: int = Field(default=16000, ge=1, le=16000)
    main_output_tokens: int = Field(default=8192, ge=1, le=8192)
    max_input_tokens: int = Field(default=80000, ge=1, le=80000)
    max_output_tokens: int = Field(default=16384, ge=1, le=16384)
    max_cost_usd: float = Field(default=0.02, gt=0, le=0.02)
    #: Main-model decisions (calls) and executed tools; `UNCERTAIN` uses the restricted pair.
    main_decisions: int = Field(default=3, ge=1, le=3)
    tool_calls: int = Field(default=6, ge=0, le=6)
    uncertain_main_decisions: int = Field(default=2, ge=1, le=2)
    uncertain_tool_calls: int = Field(default=3, ge=0, le=3)
    #: Tokens one tool result may add to the model context; larger results are rejected.
    tool_result_tokens: int = Field(default=5000, ge=1, le=5000)
    #: Complete earlier exchanges shown to the stages, newest first, and their token budget.
    #: `UNCERTAIN` uses the smaller Main budget; Security also stays within its own input cap.
    history_exchanges: int = Field(default=6, ge=0, le=6)
    history_tokens: int = Field(default=6000, ge=0, le=6000)
    uncertain_history_tokens: int = Field(default=3000, ge=0, le=3000)
