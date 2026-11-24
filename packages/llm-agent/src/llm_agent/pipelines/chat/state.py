"""The state of one execution: what the graph passes between stages and what it never shares.

`Execution` holds the per-execution resources (budget, deadline, tools, trace). It is created for
every run and passed to the graph through its run configuration, so two executions never share
evidence, usage or spans.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Final, Literal, TypedDict

from pydantic import BaseModel, ConfigDict, Field, field_validator

from llm_agent.guardrails.output import Draft
from llm_agent.models.gateway import Gateway
from llm_agent.observability.tracing import Tracer
from llm_agent.reliability.budgets import Budget
from llm_agent.reliability.stops import ExecutionStopped
from llm_agent.reliability.timeouts import Deadline
from llm_agent.schemas import ChatRequest, ChatResult, ExecutionLimits, Language
from llm_agent.tools.registry import Tools

VerdictValue = Literal["ALLOW", "BLOCK", "UNCERTAIN"]
Category = Literal["none", "injection", "prompt_extraction", "admin_write", "off_topic", "abuse"]

#: The shape of a reason code that may reach a span: lower-case ASCII words joined by single
#: underscores, at most 64 characters, no digits (#398).
REASON_CODE_PATTERN: Final = r"^[a-z]+(?:_[a-z]+)*$"
REASON_CODE_MAX: Final = 64
#: The fixed code that replaces any other reason code the classifier writes.
REPLACED_REASON_CODE: Final = "reason_replaced"

_REASON_CODE: Final = re.compile(REASON_CODE_PATTERN)


class Verdict(BaseModel):
    """The Security Gateway classification; anything else the classifier returns is invalid.

    The classifier writes `reason_code` itself and an injected question can steer it, so a code
    outside the allowed shape is replaced by `REPLACED_REASON_CODE` before the verdict exists:
    free text never reaches the trace or the telemetry record. The replacement leaves the verdict
    and the category as the classifier gave them and is not a classifier failure.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    verdict: VerdictValue
    category: Category
    reason_code: str = Field(min_length=1, max_length=REASON_CODE_MAX, pattern=REASON_CODE_PATTERN)

    @field_validator("reason_code", mode="before")
    @classmethod
    def _shaped(cls, value: object) -> object:
        if not isinstance(value, str):
            return value  # not a string: the verdict is invalid
        if len(value) <= REASON_CODE_MAX and _REASON_CODE.fullmatch(value):
            return value
        return REPLACED_REASON_CODE

    @property
    def blocks(self) -> bool:
        """Whether the turn ends at Security with a fixed refusal: every `BLOCK`, and an
        `UNCERTAIN` verdict in the `abuse` category (#455). Abuse has no partial answer: a message
        that mixes abusive or hateful text with a profile question is refused as a whole, so that
        text never reaches Main, a tool or an answer. Other `UNCERTAIN` verdicts run the
        restricted Main stage."""
        return self.verdict == "BLOCK" or (self.verdict == "UNCERTAIN" and self.category == "abuse")


@dataclass
class Execution:
    request: ChatRequest
    limits: ExecutionLimits
    language: Language
    budget: Budget
    deadline: Deadline
    gateway: Gateway
    tools: Tools
    tracer: Tracer


class ChatState(TypedDict, total=False):
    verdict: Verdict
    #: The Main Agent's draft, held back until the Output Guard approves it.
    draft: Draft
    #: The Main Agent declined the request as out of scope.
    declined: bool
    stopped: ExecutionStopped
    result: ChatResult
