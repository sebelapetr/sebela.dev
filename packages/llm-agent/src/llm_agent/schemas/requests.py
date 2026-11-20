"""What a caller passes in: the question, execution identifiers and the limits it grants.

The defaults of `ExecutionLimits` are the owner-agreed initial limits (`.plan/06-llm-agent/prd.md`,
Initial execution limits). A caller may only tighten them; nothing the model writes changes them.
"""

from __future__ import annotations

import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

#: A transport bound far above the question token cap: a longer question is malformed input,
#: a shorter one that exceeds the cap is a `limit_reached` result (`question_too_long`).
MAX_QUESTION_CHARS = 32000


class ChatRequest(BaseModel):
    """One visitor turn. Identifiers are opaque and only label the trace."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    question: str = Field(max_length=MAX_QUESTION_CHARS)
    execution_id: str | None = Field(default=None, max_length=128)
    trace_id: str | None = Field(default=None, max_length=128)
    #: The trusted caller's Europe/Prague calendar day; relative windows ("this week") need it.
    #: Without it the agent knows no date and answers such questions without one.
    today: datetime.date | None = None

    @field_validator("question")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("the question is empty")
        return value


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
