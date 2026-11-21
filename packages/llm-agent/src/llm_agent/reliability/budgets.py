"""The execution allowance: admission before every model attempt and settlement after it.

Every attempt is admitted only if its estimated input, its output ceiling and its conservatively
priced cost fit what remains of the stage and execution caps. The output ceiling sent to the
provider is the stage cap or the remaining aggregate output, whichever is smaller. An attempt whose
usage is unknown (timeout, connection loss, cancellation, missing usage) is charged its whole
reservation and marks the cost uncertain.
"""

from __future__ import annotations

from dataclasses import dataclass

from llm_agent.models.config import Prices
from llm_agent.models.usage import MeasuredUsage, estimated_cost_usd
from llm_agent.reliability.stops import LimitReached
from llm_agent.schemas import ExecutionLimits, Usage

#: An attempt whose output ceiling would fall below this cannot produce a usable answer.
MIN_OUTPUT_TOKENS = 64


@dataclass(frozen=True)
class Admission:
    input_tokens: int
    max_tokens: int
    reserved_usd: float
    prices: Prices


class Budget:
    def __init__(self, limits: ExecutionLimits) -> None:
        self._limits = limits
        self.attempts = 0
        self.retries = 0
        self.input_tokens = 0
        self.output_tokens = 0
        self.cache_read_tokens = 0
        self.cache_creation_tokens = 0
        self.cost_usd = 0.0
        self.uncertain = False
        #: The admission of the attempt in flight, charged in full if the execution stops.
        self.in_flight: Admission | None = None

    def admit(
        self, *, input_tokens: int, input_cap: int, output_cap: int, prices: Prices
    ) -> Admission:
        limits = self._limits
        if self.attempts >= limits.model_attempts:
            raise LimitReached("model_attempts")
        if input_tokens > input_cap:
            raise LimitReached("context_too_large")
        if self.input_tokens + input_tokens > limits.max_input_tokens:
            raise LimitReached("input_tokens")
        max_tokens = min(output_cap, limits.max_output_tokens - self.output_tokens)
        if max_tokens < MIN_OUTPUT_TOKENS:
            raise LimitReached("output_tokens")
        reserved = estimated_cost_usd(input_tokens, max_tokens, prices)
        if self.cost_usd + reserved > limits.max_cost_usd:
            raise LimitReached("cost_allowance")
        self.attempts += 1
        admission = Admission(input_tokens, max_tokens, reserved, prices)
        self.in_flight = admission
        return admission

    def allow_retry(self) -> bool:
        if self.retries >= self._limits.retries:
            return False
        self.retries += 1
        return True

    def settle(self, admission: Admission, usage: MeasuredUsage | None) -> None:
        """Charges a finished attempt: measured usage, or the whole reservation when unknown."""
        self.in_flight = None
        if usage is None:
            self.input_tokens += admission.input_tokens
            self.output_tokens += admission.max_tokens
            self.cost_usd += admission.reserved_usd
            self.uncertain = True
            return
        self.input_tokens += usage.input_tokens
        self.output_tokens += usage.output_tokens
        self.cache_read_tokens += usage.cache_read_tokens
        self.cache_creation_tokens += usage.cache_creation_tokens
        self.cost_usd += usage.cost_usd(admission.prices)

    def settle_unbilled(self, admission: Admission) -> None:
        """An attempt the provider rejected with a status error produced no tokens."""
        self.in_flight = None

    def abandon(self) -> None:
        """The execution stopped with an attempt in flight: its usage can no longer be known."""
        if self.in_flight is not None:
            self.settle(self.in_flight, None)

    def usage(self) -> Usage:
        return Usage(
            model_attempts=self.attempts,
            retries=self.retries,
            input_tokens=self.input_tokens,
            output_tokens=self.output_tokens,
            cache_read_tokens=self.cache_read_tokens,
            cache_creation_tokens=self.cache_creation_tokens,
            cost_usd=round(self.cost_usd, 8),
            cost_uncertain=self.uncertain,
        )
