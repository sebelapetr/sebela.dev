"""The agent's results as the API's result bodies, and the API's working context as the agent's.

Only what the contract carries leaves the service: the approved text, the typed blocks, the
sources, the usage and the last main call's context size. Evidence data, the trace, the execution
identifiers and any draft stay inside. Agent source kinds become the contract's record kinds; the
contact card becomes a `ContactCard` block without the name, with only `http`/`https` links.
A compaction's result carries its summary only when it is `compacted`; the summary keeps the
agent's own source kinds, since only this service and the agent read it back.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from typing import Final
from urllib.parse import urlsplit

from llm_agent import (
    ChatExchange,
    ChatResult,
    CompactionResult,
    ContactCard,
    ContextSummary,
    ExchangeSource,
    Span,
    SummaryReference,
    Versions,
)
from llm_agent.schemas.responses import SourceKind
from pydantic.alias_generators import to_camel

from ai_service.schemas import (
    MAX_BLOCKS,
    MAX_SOURCES,
    SITE_PATH_PATTERN,
    CompactionReport,
    ContractKind,
    HistoryExchange,
    Language,
    Outcome,
    ReportContext,
    ReportRecord,
    ReportSource,
    ReportUsage,
    ResultReport,
    WireReference,
    WireSummary,
)

_CONTRACT_KIND: Final[dict[str, ContractKind]] = {
    "profile": "person",
    "contact": "person",
    "experience": "experience",
    "project": "project",
    "exploration": "exploration",
    "service": "service",
    "roadmap": "roadmap_item",
    "roadmap_area": "roadmap_item",
    "roadmap_module": "roadmap_item",
}

_AGENT_KIND: Final[dict[ContractKind, SourceKind]] = {
    "person": "profile",
    "technology_group": "profile",
    "roadmap_item": "roadmap",
    "experience": "experience",
    "project": "project",
    "exploration": "exploration",
    "service": "service",
}

_SITE_PATH = re.compile(SITE_PATH_PATTERN)
#: The trace span of one main model attempt (`llm_agent`'s gateway).
_MAIN_ATTEMPT: Final = "model.main"
_MAX_CONTACT_LINKS = 6
#: The agent's own bound on an earlier exchange's record identifier.
_MAX_HISTORY_RECORD_ID = 128


def report_for(
    result: ChatResult,
    *,
    grant: str,
    latency_ms: int,
    interrupted: bool = False,
    stopped: bool = False,
) -> ResultReport:
    """The result body for `result`.

    `interrupted` (shutdown) reports it `cancelled (interrupted)` with uncertain usage; `stopped`
    (the API's Stop) reports it `cancelled (stopped)` with the usage the agent measured, which is
    uncertain exactly when a model call was in flight.
    """
    usage = result.usage
    reason = "interrupted" if interrupted else "stopped" if stopped else result.reason
    blocks = [block.model_dump(mode="json", by_alias=True) for block in result.blocks]
    if result.contact is not None:
        blocks = [*blocks[: MAX_BLOCKS - 1], _contact_block(result.contact)]
    return ResultReport(
        grant=grant,
        outcome="cancelled" if interrupted or stopped else result.outcome,
        reason=reason,
        language=result.language,
        text=result.text,
        blocks=blocks,
        sources=_sources(result),
        related=[],
        usage=ReportUsage(
            cost_usd=usage.cost_usd,
            cost_uncertain=usage.cost_uncertain or interrupted,
            input_tokens=usage.input_tokens,
            output_tokens=usage.output_tokens,
            model_attempts=usage.model_attempts,
        ),
        versions=_versions(result.versions),
        latency_ms=max(0, latency_ms),
        context=_context(result.trace),
    )


def stopped_report(
    outcome: Outcome,
    reason: str,
    *,
    grant: str,
    latency_ms: int,
    versions: Versions,
    language: Language = "en",
) -> ResultReport:
    """The result of an operation that stopped before any model call: no text and no cost."""
    return ResultReport(
        grant=grant,
        outcome=outcome,
        reason=reason,
        language=language,
        text="",
        blocks=[],
        sources=[],
        related=[],
        usage=ReportUsage(
            cost_usd=0.0, cost_uncertain=False, input_tokens=0, output_tokens=0, model_attempts=0
        ),
        versions=_versions(versions),
        latency_ms=max(0, latency_ms),
    )


def compaction_report(
    result: CompactionResult,
    *,
    grant: str,
    latency_ms: int,
    interrupted: bool = False,
    stopped: bool = False,
) -> CompactionReport:
    """The result body for a compaction; anything not `compacted` carries no summary.

    `interrupted` and `stopped` report it `failed` with their reason, like a generation's Stop.
    """
    usage = result.usage
    compacted = result.outcome == "compacted" and not (interrupted or stopped)
    reason = "interrupted" if interrupted else "stopped" if stopped else result.reason
    return CompactionReport(
        grant=grant,
        outcome="compacted"
        if compacted
        else "failed"
        if interrupted or stopped
        else result.outcome,
        reason=None if compacted else reason or "invalid_summary",
        summary=wire_summary(result.summary) if compacted and result.summary else None,
        kept=result.kept,
        summary_tokens=result.summary_tokens if compacted else 0,
        next_input_tokens=result.next_input_tokens,
        usage=ReportUsage(
            cost_usd=usage.cost_usd,
            cost_uncertain=usage.cost_uncertain or interrupted,
            input_tokens=usage.input_tokens,
            output_tokens=usage.output_tokens,
            model_attempts=usage.model_attempts,
        ),
        versions=_versions(result.versions),
        latency_ms=max(0, latency_ms),
    )


def stopped_compaction(
    reason: str, *, grant: str, kept: int, latency_ms: int, versions: Versions
) -> CompactionReport:
    """A compaction that stopped before any model call: nothing installed, no cost."""
    return CompactionReport(
        grant=grant,
        outcome="failed",
        reason=reason,
        summary=None,
        kept=kept,
        summary_tokens=0,
        next_input_tokens=None,
        usage=ReportUsage(
            cost_usd=0.0, cost_uncertain=False, input_tokens=0, output_tokens=0, model_attempts=0
        ),
        versions=_versions(versions),
        latency_ms=max(0, latency_ms),
    )


def wire_summary(summary: ContextSummary) -> WireSummary:
    """The agent's validated summary in the API's camelCase shape."""
    return WireSummary(
        language=summary.language,
        goals=list(summary.goals),
        open_questions=list(summary.open_questions),
        covered=list(summary.covered),
        visitor_claims=list(summary.visitor_claims),
        references=[
            WireReference(kind=ref.kind, record_id=ref.record_id, title=ref.title)
            for ref in summary.references
        ],
    )


def summary_for(summary: WireSummary | None) -> ContextSummary | None:
    """The API's stored summary as the agent's, validated again; untrusted history."""
    if summary is None:
        return None
    return ContextSummary(
        language=summary.language,
        goals=tuple(summary.goals),
        open_questions=tuple(summary.open_questions),
        covered=tuple(summary.covered),
        visitor_claims=tuple(summary.visitor_claims),
        references=tuple(
            SummaryReference(kind=ref.kind, record_id=ref.record_id, title=ref.title)
            for ref in summary.references
        ),
    )


def history_for(history: Sequence[HistoryExchange]) -> list[ChatExchange]:
    """The API's bounded history as the agent's exchanges, with the agent's source kinds."""
    return [
        ChatExchange(
            question=exchange.question,
            answer=exchange.answer,
            language=exchange.language,
            sources=tuple(
                ExchangeSource(
                    kind=_AGENT_KIND[source.kind], record_id=source.record_id, title=source.title
                )
                for source in exchange.sources
                if len(source.record_id) <= _MAX_HISTORY_RECORD_ID
            ),
        )
        for exchange in history
    ]


def _context(trace: Sequence[Span]) -> ReportContext | None:
    """The last main model attempt's estimated input against its cap, with the provider's count.

    The estimate is the agent's conservative token estimate of everything the attempt sent
    (instructions, tool definitions, history, question, evidence); the count is what the provider
    reported, `None` when it reported nothing. No measured main attempt is no context, never zero.
    """
    for span in reversed(trace):
        if span.name != _MAIN_ATTEMPT:
            continue
        estimate = _count(span.attributes.get("estimated_input_tokens"))
        cap = _count(span.attributes.get("input_cap"))
        if estimate is None or cap is None or cap == 0:
            return None
        return ReportContext(
            estimated_input_tokens=estimate,
            reported_input_tokens=_count(span.attributes.get("input_tokens")),
            cap_tokens=cap,
        )
    return None


def _count(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def _sources(result: ChatResult) -> list[ReportSource]:
    seen: set[tuple[str, str]] = set()
    sources: list[ReportSource] = []
    for source in result.sources:
        kind = _CONTRACT_KIND.get(source.kind, "person")
        title = source.title.strip()[:200]
        key = (kind, source.record_id)
        if key in seen or not title or not _SITE_PATH.fullmatch(source.href):
            continue
        if not 0 < len(source.record_id) <= 200:
            continue
        seen.add(key)
        sources.append(
            ReportSource(
                record=ReportRecord(kind=kind, id=source.record_id), title=title, href=source.href
            )
        )
        if len(sources) == MAX_SOURCES:
            break
    return sources


def _contact_block(contact: ContactCard) -> dict[str, object]:
    links = [
        {"label": link.label, "url": link.url}
        for link in contact.links
        if _http_url(link.url) and 0 < len(link.label.strip()) <= 100
    ]
    return {"type": "ContactCard", "email": contact.email, "links": links[:_MAX_CONTACT_LINKS]}


def _http_url(url: str) -> bool:
    parts = urlsplit(url)
    return parts.scheme in ("http", "https") and bool(parts.hostname) and len(url) <= 2048


def _versions(versions: Versions) -> dict[str, str]:
    return {to_camel(name): value[:200] for name, value in versions.model_dump().items()}
