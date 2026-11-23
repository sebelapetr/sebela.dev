"""Optional export of a finished execution to the caller's telemetry.

The caller passes a `TelemetrySink`; after the result of an answer (`run`) or a compaction
(`compact`) is final the agent hands it one redacted `ExecutionRecord`: the operation, outcome,
reason, language, usage, versions and the spans, never visitor text, model text, summary text or
tool data. `otlp_trace` (`export.py`) turns a record into the metadata-only payload of an
export. Export is best effort: a sink that raises is ignored, so a telemetry failure can never
change a safety decision, a limit or the result.
"""

from __future__ import annotations

import contextlib
from typing import Literal, Protocol

from pydantic import BaseModel, ConfigDict

from llm_agent.schemas import (
    ChatResult,
    CompactionOutcome,
    CompactionResult,
    Language,
    Outcome,
    Span,
    Usage,
    Versions,
)

Operation = Literal["answer", "compact"]


class ExecutionRecord(BaseModel):
    """What one execution exports: identifiers, the typed outcome, usage and redacted spans."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    execution_id: str | None
    trace_id: str | None
    operation: Operation
    outcome: Outcome | CompactionOutcome
    reason: str | None
    #: The answer's language, or the summary's for a compaction (None when it installed none).
    language: Language | None
    usage: Usage
    versions: Versions
    spans: list[Span]


class TelemetrySink(Protocol):
    """Receives the record on the event loop, synchronously, before `run` returns.

    `export` must not block or do I/O: it should only enqueue the record (for example on an
    `asyncio.Queue` or a background exporter's buffer). A slow sink delays the caller and every
    other execution on the loop, though it cannot change the result.
    """

    def export(self, record: ExecutionRecord) -> None: ...


def export(sink: TelemetrySink | None, result: ChatResult | CompactionResult) -> None:
    """Hands the sink the record of a final result; any sink failure is swallowed."""
    if sink is None:
        return
    if isinstance(result, CompactionResult):
        operation: Operation = "compact"
        language = result.summary.language if result.summary else None
    else:
        operation = "answer"
        language = result.language
    record = ExecutionRecord(
        execution_id=result.execution_id,
        trace_id=result.trace_id,
        operation=operation,
        outcome=result.outcome,
        reason=result.reason,
        language=language,
        usage=result.usage,
        versions=result.versions,
        spans=list(result.trace),
    )
    with contextlib.suppress(Exception):
        sink.export(record)
