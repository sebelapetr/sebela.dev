"""Optional export of a finished execution to the caller's telemetry.

The caller passes a `TelemetrySink`; after the result is final the agent hands it one redacted
`ExecutionRecord`: outcome, reason, language, usage, versions and the spans, never visitor text,
model text or tool data. Export is best effort: a sink that raises is ignored, so a telemetry
failure can never change a safety decision, a limit or the result.
"""

from __future__ import annotations

import contextlib
from typing import Protocol

from pydantic import BaseModel, ConfigDict

from llm_agent.schemas import ChatResult, Language, Outcome, Span, Usage, Versions


class ExecutionRecord(BaseModel):
    """What one execution exports: identifiers, the typed outcome, usage and redacted spans."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    execution_id: str | None
    trace_id: str | None
    outcome: Outcome
    reason: str | None
    language: Language
    usage: Usage
    versions: Versions
    spans: list[Span]


class TelemetrySink(Protocol):
    def export(self, record: ExecutionRecord) -> None: ...


def export(sink: TelemetrySink | None, result: ChatResult) -> None:
    """Hands the sink the record of a final result; any sink failure is swallowed."""
    if sink is None:
        return
    record = ExecutionRecord(
        execution_id=result.execution_id,
        trace_id=result.trace_id,
        outcome=result.outcome,
        reason=result.reason,
        language=result.language,
        usage=result.usage,
        versions=result.versions,
        spans=list(result.trace),
    )
    with contextlib.suppress(Exception):
        sink.export(record)
