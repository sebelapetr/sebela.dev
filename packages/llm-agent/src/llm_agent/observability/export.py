"""The metadata-only OTLP/JSON trace of one execution, in the shape Langfuse ingests.

`otlp_trace(record, ...)` is the one way a record leaves for an external trace store. It builds
the body by hand rather than through an OpenTelemetry or Langfuse SDK, so no instrumentation,
callback, exporter default or resource detector can add a value this module did not choose:

- one root span (`chat.answer` or `chat.compact`) carrying the trace's name, outcome, reason,
  language, versions, usage and cost, the export mode and, when the content is withheld for a
  reason, that reason (`degraded`);
- a nested span per stage, model attempt, tool call and guard decision. A stage (`stage.*`) or
  the compaction is a child of the root; every other span is a child of the first stage recorded
  after it that holds it in time (the tracer records a span when it finishes, and whole-ms
  rounding blurs the boundaries), else of the shortest stage that holds it, else of the root;
- names and statuses only from a fixed vocabulary (anything else becomes `<kind>.unnamed` or
  `unknown`), and span attributes only from `ATTRIBUTES`, filtered and rule-masked recursively
  through `filter_fields`;
- no input, output, events, links, exception records, host, process or network attributes, and
  the resource is `service.name` only. The execution (operation) identifier is not exported: the
  API maps the trace identifier to its operation.

Visitor text, model text, summaries and tool data are not in a record, so even a masked payload
export is not implemented here: `export_mode` is always `metadata` (`AGENTS.md`, Trace
pseudonymization).
"""

from __future__ import annotations

import json
import re
import secrets
from typing import Any, Final

from llm_agent.observability.pseudonymization import Pseudonymizer, Scope, filter_fields
from llm_agent.observability.telemetry import ExecutionRecord
from llm_agent.schemas import Span

#: The span attributes an export may carry; everything else is dropped.
ATTRIBUTES: Final = frozenset(
    {
        "model",
        "effort",
        "attempt",
        "estimated_input_tokens",
        "input_cap",
        "input_tokens",
        "output_tokens",
        "verdict",
        "category",
        "action",
        "outcome",
        "unpublished",
        "declined",
        "uncertain",
        "history_exchanges",
        "history_summary",
        "folded_exchanges",
        "kept_exchanges",
    }
)

_TRACE_ID = re.compile(r"[0-9a-f]{32}")
_NAME = re.compile(r"(?:stage|model|tool|guard)\.[a-z_]{1,40}|compaction")
_KIND = re.compile(r"(stage|model|tool|guard)\.")
_WORD = re.compile(r"[a-z_]{1,40}")
_WARNING: Final = frozenset({"transient_error", "invalid", "rejected"})
_TROUBLED: Final = frozenset({"unavailable", "failed", "limit_reached", "cancelled"})
_GUARDS: Final = frozenset({"stage.security", "stage.output"})
_NS_PER_MS: Final = 1_000_000
_SPAN_ERROR: Final = 2


def otlp_trace(
    record: ExecutionRecord,
    *,
    trace_id: str,
    ended_at_ns: int,
    service: str,
    environment: str,
    degraded: str | None = None,
) -> dict[str, Any]:
    """The OTLP/JSON `ExportTraceServiceRequest` of `record`, ending at `ended_at_ns`.

    Raises `ValueError` for a trace identifier that is not 32 lowercase hex digits or is all zero.
    """
    if not _TRACE_ID.fullmatch(trace_id) or trace_id == "0" * 32:
        raise ValueError("the trace id must be 32 lowercase hex digits and not all zero")
    scope = Scope()
    pseudonymizer = Pseudonymizer()
    total_ms = max((span.start_ms + span.duration_ms for span in record.spans), default=0)
    origin = ended_at_ns - total_ms * _NS_PER_MS
    root_id = _span_id()
    name = f"chat.{record.operation}"
    ids = [_span_id() for _ in record.spans]
    containers = [index for index, span in enumerate(record.spans) if _container(span)]
    spans = [
        _otlp_span(
            trace_id,
            root_id,
            name,
            origin,
            ended_at_ns,
            _root_attributes(record, name, environment, degraded),
            level=_root_level(record),
        )
    ]
    for index, span in enumerate(record.spans):
        parent = root_id
        if index not in containers:
            holder = _holder(index, record.spans, containers)
            if holder is not None:
                parent = ids[holder]
        start = origin + span.start_ms * _NS_PER_MS
        end = min(start + span.duration_ms * _NS_PER_MS, ended_at_ns)
        status = span.status if _WORD.fullmatch(span.status) else "unknown"
        filtered = filter_fields(span.attributes, ATTRIBUTES, pseudonymizer, (), scope)
        spans.append(
            _otlp_span(
                trace_id,
                ids[index],
                _name(span.name),
                start,
                end,
                _span_attributes(_name(span.name), status, filtered),
                parent=parent,
                failed=status != "ok",
            )
        )
    return {
        "resourceSpans": [
            {
                "resource": {"attributes": _attributes({"service.name": service})},
                "scopeSpans": [
                    {
                        "scope": {"name": "llm_agent", "version": record.versions.package},
                        "spans": spans,
                    }
                ],
            }
        ]
    }


def _span_id() -> str:
    while (value := secrets.token_hex(8)) == "0" * 16:
        pass
    return value


def _name(name: str) -> str:
    if _NAME.fullmatch(name):
        return name
    kind = _KIND.match(name)
    return f"{kind.group(1)}.unnamed" if kind else "span.unnamed"


def _container(span: Span) -> bool:
    name = _name(span.name)
    return name.startswith("stage.") or name == "compaction"


def _holder(index: int, spans: list[Span], containers: list[int]) -> int | None:
    """The index of the container that holds `spans[index]`, or `None`.

    The tracer records a span when it finishes, so a stage follows its own spans: the first
    container recorded after the span whose time holds it wins, with 2 ms for the separate
    rounding of start and duration on both sides. Otherwise, for records not in that order, the
    shortest container whose time holds it (1 ms rounding allowed).
    """
    span = spans[index]
    for position in containers:
        if position > index and _holds(spans[position], span, 2):
            return position
    best: int | None = None
    for position in containers:
        if _holds(spans[position], span, 1) and (
            best is None or spans[position].duration_ms < spans[best].duration_ms
        ):
            best = position
    return best


def _holds(container: Span, span: Span, slack_ms: int) -> bool:
    end = container.start_ms + container.duration_ms + slack_ms
    return container.start_ms <= span.start_ms and span.start_ms + span.duration_ms <= end


def _type(name: str) -> str:
    if name.startswith("model."):
        return "generation"
    if name.startswith("tool."):
        return "tool"
    if name.startswith("guard.") or name in _GUARDS:
        return "guardrail"
    if name == "stage.main":
        return "agent"
    if name == "compaction":
        return "chain"
    return "span"


def _span_attributes(name: str, status: str, filtered: dict[str, Any]) -> dict[str, str]:
    values = {
        "langfuse.observation.type": _type(name),
        "langfuse.observation.level": (
            "DEFAULT" if status == "ok" else "WARNING" if status in _WARNING else "ERROR"
        ),
    }
    if status != "ok":
        values["langfuse.observation.status_message"] = status
    for key, value in filtered.items():
        if value is not None:
            values[f"langfuse.observation.metadata.{key}"] = _text(value)
    if name.startswith("model."):
        model = filtered.get("model")
        if isinstance(model, str):
            values["langfuse.observation.model.name"] = model
        tokens = (filtered.get("input_tokens"), filtered.get("output_tokens"))
        if all(isinstance(count, int) and not isinstance(count, bool) for count in tokens):
            values["langfuse.observation.usage_details"] = json.dumps(
                {"input": tokens[0], "output": tokens[1]}
            )
    return values


def _root_attributes(
    record: ExecutionRecord, name: str, environment: str, degraded: str | None
) -> dict[str, str]:
    metadata: dict[str, Any] = {
        "operation": record.operation,
        "outcome": record.outcome,
        "reason": record.reason,
        "language": record.language,
        "export_mode": "metadata",
        "usage": json.dumps(record.usage.model_dump(mode="json"), sort_keys=True),
        **record.versions.model_dump(mode="json"),
    }
    if degraded is not None:
        metadata["degraded"] = degraded if _WORD.fullmatch(degraded) else "unknown"
    values = {
        "langfuse.trace.name": name,
        "langfuse.observation.type": "span",
        "langfuse.environment": environment,
        "langfuse.version": record.versions.package,
        "langfuse.observation.cost_details": json.dumps({"total": record.usage.cost_usd}),
    }
    for key, value in metadata.items():
        if value is not None:
            values[f"langfuse.trace.metadata.{key}"] = _text(value)
    return values


def _root_level(record: ExecutionRecord) -> str:
    return "WARNING" if record.outcome in _TROUBLED else "DEFAULT"


def _text(value: object) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int | float):
        return str(value)
    return json.dumps(value, sort_keys=True)


def _attributes(values: dict[str, str]) -> list[dict[str, Any]]:
    return [{"key": key, "value": {"stringValue": value}} for key, value in values.items()]


def _otlp_span(
    trace_id: str,
    span_id: str,
    name: str,
    start: int,
    end: int,
    values: dict[str, str],
    *,
    parent: str | None = None,
    failed: bool = False,
    level: str | None = None,
) -> dict[str, Any]:
    if level is not None:
        values = {**values, "langfuse.observation.level": level}
    span: dict[str, Any] = {
        "traceId": trace_id,
        "spanId": span_id,
        "name": name,
        "kind": 1,
        "startTimeUnixNano": str(start),
        "endTimeUnixNano": str(max(end, start)),
        "attributes": _attributes(values),
        "status": {"code": _SPAN_ERROR} if failed else {},
    }
    if parent is not None:
        span["parentSpanId"] = parent
    return span
