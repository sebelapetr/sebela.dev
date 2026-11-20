"""Model attempts: admission, the bounded attempt, settlement and the single retry policy.

A stage asks for one completion; this module owns everything around it. The provider-facing model
is built per attempt by a `ModelFactory` from a validated `ModelCall`, so tests substitute scripted
models and production uses `anthropic_model_factory()` (LangChain's ChatAnthropic with SDK retries
disabled). Every attempt is admitted against the execution budget first and bounded by its stage
timeout and the execution deadline, and is recorded as a `model.<stage>` span with its model,
effort, attempt number and the provider-reported tokens (thinking tokens are part of the output
tokens; the provider does not report them separately).
"""

from __future__ import annotations

import asyncio
from collections.abc import Mapping, Sequence
from typing import Any, Protocol

import anthropic
from langchain_core.messages import BaseMessage
from pydantic import BaseModel, ConfigDict, Field

from llm_agent.context.tokens import request_tokens
from llm_agent.models.config import STAGES, Effort, Stage
from llm_agent.models.usage import measured
from llm_agent.observability.tracing import Tracer
from llm_agent.reliability.budgets import Budget
from llm_agent.reliability.retries import is_transient
from llm_agent.reliability.stops import LimitReached
from llm_agent.reliability.timeouts import Deadline

#: The pause before the single retry, bounded by the deadline.
RETRY_BACKOFF_S = 0.25
#: The token attributes of an attempt the provider did not bill or report.
_NO_TOKENS: dict[str, int | None] = {"input_tokens": None, "output_tokens": None}


class ModelCall(BaseModel):
    """Everything one model attempt is configured with; never visitor- or model-controlled."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    stage: Stage
    model: str
    effort: Effort
    max_tokens: int = Field(gt=0)
    timeout_s: float = Field(gt=0)
    #: Anthropic tool definitions; empty for the Security Gateway.
    tools: tuple[dict[str, Any], ...] = ()
    #: The JSON schema the provider must return (structured output).
    response_schema: dict[str, Any]


class ChatModel(Protocol):
    async def ainvoke(self, input: Sequence[BaseMessage]) -> BaseMessage: ...


class ModelFactory(Protocol):
    def __call__(self, call: ModelCall) -> ChatModel: ...


class ModelUnavailable(Exception):
    """The stage's model failed and the retry allowance cannot cover another attempt."""


def anthropic_model_factory() -> ModelFactory:
    """Anthropic models through LangChain; the key comes from `ANTHROPIC_API_KEY`."""
    from langchain_anthropic import ChatAnthropic

    def build(call: ModelCall) -> ChatModel:
        settings: dict[str, Any] = {
            "model": call.model,
            "max_tokens": call.max_tokens,
            "timeout": call.timeout_s,
            "max_retries": 0,
            "thinking": {"type": "adaptive"},
            "effort": call.effort,
            "output_config": {"format": {"type": "json_schema", "schema": call.response_schema}},
        }
        model = ChatAnthropic(**settings)
        if call.tools:
            bound: ChatModel = model.bind_tools(list(call.tools))
            return bound
        return model

    return build


class Gateway:
    """The model attempts of one execution."""

    def __init__(
        self, models: ModelFactory, budget: Budget, deadline: Deadline, tracer: Tracer
    ) -> None:
        self._models = models
        self._budget = budget
        self._deadline = deadline
        self._tracer = tracer

    async def complete(
        self,
        stage: Stage,
        messages: Sequence[BaseMessage],
        *,
        schema: Mapping[str, Any],
        tools: Sequence[Mapping[str, Any]] = (),
        input_cap: int,
        output_cap: int,
        attempt_s: float,
    ) -> BaseMessage:
        config = STAGES[stage]
        attempt = 0
        while True:
            attempt += 1
            if self._deadline.expired:
                raise LimitReached("deadline")
            admission = self._budget.admit(
                input_tokens=request_tokens(messages, tools, schema),
                input_cap=input_cap,
                output_cap=output_cap,
                prices=config.prices,
            )
            timeout = self._deadline.bounded(attempt_s)
            model = self._models(
                ModelCall(
                    stage=stage,
                    model=config.model,
                    effort=config.effort,
                    max_tokens=admission.max_tokens,
                    timeout_s=max(timeout, 0.001),
                    tools=tuple(dict(tool) for tool in tools),
                    response_schema=dict(schema),
                )
            )
            span = f"model.{stage}"
            started = self._tracer.start()
            labels: dict[str, str | int | None] = {
                "model": config.model,
                "effort": config.effort,
                "attempt": attempt,
            }
            try:
                async with asyncio.timeout(timeout):
                    reply = await model.ainvoke(list(messages))
            except anthropic.APIStatusError as error:
                self._budget.settle_unbilled(admission)
                failure: Exception = error
            except Exception as error:
                # Timeouts, connection losses and unexpected failures: usage is unknown.
                self._budget.settle(admission, None)
                if isinstance(error, TimeoutError) and self._deadline.expired:
                    self._tracer.finish(span, "timeout", started, **labels, **_NO_TOKENS)
                    raise LimitReached("deadline") from error
                failure = error
            else:
                usage = measured(reply)
                self._budget.settle(admission, usage)
                tokens = (
                    {"input_tokens": usage.input_tokens, "output_tokens": usage.output_tokens}
                    if usage
                    else _NO_TOKENS
                )
                self._tracer.finish(span, "ok", started, **labels, **tokens)
                return reply
            status = "transient_error" if is_transient(failure) else "error"
            if isinstance(failure, TimeoutError):
                status = "timeout"
            self._tracer.finish(span, status, started, **labels, **_NO_TOKENS)
            if not (is_transient(failure) and self._budget.allow_retry()):
                raise ModelUnavailable(stage) from failure
            await asyncio.sleep(self._deadline.bounded(RETRY_BACKOFF_S))
