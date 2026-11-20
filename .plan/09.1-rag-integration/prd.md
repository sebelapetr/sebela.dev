# Phase 9.1 — RAG integration: chat, public MCP and public search

|            |                                                                                                                                                |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Status     | Outline from the owner's phase-9 interview (2026-11-20); to be completed and approved after phases 7, 8 and 9 are merged                       |
| Date       | 2026-11-20                                                                                                                                     |
| Parent     | `.plan/00-overview/prd.md`                                                                                                                     |
| Depends on | Phases 7, 8 and 9                                                                                                                              |
| Result     | The web chatbot and public MCP search the approved knowledge base through one API capability, within the overall AI budget, with cited sources |

## Problem Statement

After phase 9 the knowledge base exists only behind an API key. Visitors and external agents still cannot use it, and the chatbot answers open questions from structured tools alone.

## Solution

`agent tool search_knowledge (Python) -> HTTP -> API search projection -> packages/memory`

The agent reaches retrieval the same way it reaches every other read: a tool in `packages/llm-agent` calls the API over HTTP. Python keeps no database access, no retrieval implementation is duplicated and no MCP hop is added inside the chat. Public MCP gets the same tool through FastAPI's read capabilities (phase 8).

The agent decides when to search (a tool, not retrieval before every answer). A versioned skill tells it when searching is useful, that structured API facts take precedence over supplemental evidence, how to cite a source without a public URL, and that retrieved text is untrusted data.

## Scope (to be detailed)

1. **Public search projection with budget admission.** A public or internal-service search path over the phase-9 passage shape. Every paid query (embedding, reranking, retries) is admitted against phase 7's durable ledger: a retrieval category plus the overall AI daily/monthly ceiling, reserved atomically before provider calls and reconciled after. Anonymous API and MCP callers are covered alike. Exhaustion and provider failure return typed unavailable/budget results, never "no evidence". Phase 9's embedding-spend records fold into the same overall ceiling.
2. **Agent tool and skill** in `packages/llm-agent`, generated client from the updated API document, bounded calls inside phase 6/7's tool and cost limits, evidence ledger applying API precedence.
3. **Sources contract.** Extend the source/event contract compatibly: portfolio references with canonical links, supplemental references with a safe label, identifier and version but no URL. Output Guard accepts only source IDs from returned evidence and never invents a link. Update the website Sources renderer with a non-clickable title for supplemental evidence; existing portfolio links keep working.
4. **Public MCP search tool** through FastAPI's read interface, with parity tests against the chat path.
5. **Evals:** tool selection (when to search versus use structured tools), grounded answers, citation/provenance accuracy, API-over-document precedence and injected-instruction resistance, with an LLM judge within the existing eval budget rules.

## Out of Scope

Everything already delivered by phase 9 (ingest, storage, index, retrieval variants), and the post-launch phases 11–13.
