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
5. **Website discovery of the public knowledge MCP** (owner request, issue [#218](https://github.com/sebelapetr/sebela.dev/issues/218)). A visitor understands why connecting their own AI to the public knowledge MCP is useful, discovers it prominently and reaches verified setup with source-backed search examples. Extend phase 8's basic discovery links with a prominent explanation and "Connect your AI" action near the homepage's AI entry point, a visible option on `/ask` and a persistent footer link, keeping one canonical `/mcp` page. On `/mcp`, explain structured reads and RAG over public portfolio content and approved supplemental passages with concrete examples; describe only delivered capabilities, never visitor memory, public ingest or private originals. Rendering the guidance makes no paid call. Keep metadata, `llms.txt` and README consistent. Tests: Playwright journeys from homepage and `/ask` to `/mcp` and copyable setup, keyboard access, screenshots at 360, 768 and 1280 px in both themes. It starts after the public MCP search slice of this phase.
6. **Delivery and launch.** A delivery issue adds the public search path to the phase-10 pipeline, stack and smoke checks. The last HITL issue is the launch: clear the demo content (backup first), load the owner's real data through admin MCP, run the one-time Road to AI roadmap import with the phase-4 count checks, ingest and approve supplemental documents and rebuild retrieval, check every page at three widths in both themes and the chat with real models, set the provider spend limit, switch indexing on and verify sitemap, `llms.txt`, structured data and analytics.
7. **Evals:** tool selection (when to search versus use structured tools), grounded answers, citation/provenance accuracy, API-over-document precedence and injected-instruction resistance, with an LLM judge within the existing eval budget rules.

## Out of Scope

Everything already delivered by phase 9 (ingest, storage, index, retrieval variants), and the post-launch phases 11–13.
