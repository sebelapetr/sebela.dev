"""The state of one execution: what the graph passes between stages and what it never shares.

`Execution` holds the per-execution resources (budget, deadline, tools, trace). It is created for
every run and passed to the graph through its run configuration, so two executions never share
evidence, usage or spans.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, TypedDict

from pydantic import BaseModel, ConfigDict, Field

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


class Verdict(BaseModel):
    """The Security Gateway classification; anything else the classifier returns is invalid."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    verdict: VerdictValue
    category: Category
    reason_code: str = Field(min_length=1, max_length=64)


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
