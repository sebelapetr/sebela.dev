# Phase 8 — Public MCP

|            |                                                                                                                                                |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Status     | Draft, revised after the owner's architecture discussion; awaiting document approval                                                           |
| Date       | 2026-11-17                                                                                                                                     |
| Parent     | `.plan/00-overview/prd.md`                                                                                                                     |
| Depends on | Phase 7                                                                                                                                        |
| Result     | A Python read-only MCP adapter and a public setup page expose the same structured read capabilities as chat, without generation or external UI |

## Problem Statement

The web chatbot can answer from the profile, but an external AI client has no standardized way to obtain those facts. Expose the existing read capabilities without duplicating tools or giving external clients access to generation or administration.

## Solution

`external agent -> apps/mcp-public -> apps/ai-service read interface -> shared package tools -> apps/api`

The external agent brings its own model. The MCP server returns structured results, source references and a text fallback; it does not run a second chat pipeline.

## User Stories

1. An external agent reads the public profile, experiences, services and learning activity with source references.
2. A visitor finds a `/mcp` setup page and copyable remote-server configuration.
3. The owner can operate public MCP independently of the web chatbot and inspect bounded failures.
4. An attacker cannot use a public MCP request to write content, read conversations or start paid chat generation.

## Implementation Decisions

- Separate Python deployable with its own Dockerfile, lifecycle, `AGENTS.md`, task wrappers and worktree port/configuration. Call FastAPI over HTTP; never import another app's source.
- Use the package's shared capability contracts. Chat calls the implementations in-process; MCP calls their FastAPI read interface. Maintain parity tests for both paths.
- Public read-only, no owner credential, no database/storage secret. Validate arguments and tool results; bound payloads, page size, execution time, concurrent work and request rates. Apply the current MCP HTTP Origin/authentication/transport requirements as applicable.
- Fixed registry of structured reads: profile, experiences/projects/case studies, explorations/status, services/evidence, technologies, education, current focus, roadmap/progress, diary/statistics, books and events.
- No chat/generation tool, arbitrary URL, SQL, filesystem, private audit/auth/conversation data or admin operation. An unknown tool fails without forwarding an arbitrary path to FastAPI.
- No embedding/search endpoint is advertised until phase 9 delivers it. That phase adds the same search capability to chat and MCP.
- Results include trusted source identifiers and site URLs/anchors where a public page exists. Validate links and evidence; model-generated text is not a source of URLs.
- A public `/mcp` page explains the server and provides verified, copyable remote setup examples for Claude, Codex, Gemini and OpenCode. Verify current client formats and transport support during implementation, not from memory.
- Link `/mcp` from main navigation, `/ask`, the homepage chat entry point, README and `llms.txt`. This is remote-server setup, not instructions to run another local copy.
- Structured data and text only. External interactive UI/MCP Apps is deliberately deferred to phase 13; website cards already delivered in phase 7 remain unchanged.

## Testing Decisions

- Deterministic protocol/contract tests with a test FastAPI/API and fictional data: discovery, schemas, pagination, result/source parity with chat tools, invalid and oversized arguments, missing records, timeout and rate limits.
- Negative tests prove public requests cannot reach generation, content writes, visitor conversations, credentials or raw source storage. Public MCP has no generation service credential.
- Evals-first for external-agent tool selection and truthful source use, under the owner-approved cost controls of 2026-11-21 ([decision 0026](../../docs/decisions/0026-eval-cost-controls-for-later-phases.md)); gates, thresholds and critical-100% rules are set before implementation and not lowered:
  - **Deterministic first.** Protocol, schemas, parity with the chat tools, no generation, unknown tool and limits are deterministic tests, not paid cases.
  - **A small paid set.** About 12 fictional cases × 3 repeats, graded by code: expected tool calls and arguments, cited source IDs. The LLM judge runs only on the truthful-source cases. Reuse the Python Promptfoo runner, its budget module, ledger and allowance, and the existing fictional fixtures rather than creating another agent platform.
  - **Pinned subject.** Claude Haiku 5.5 for development and the gate, plus one confirmation run with Claude Sonnet 5.5 at the phase PR (about USD 1.3). Use prompt caching on the fixed tool list. While a tool description or schema is still changing, screen with 1 repeat without the judge, then 1 judged repeat; only the final version's 3-repeat run counts for the gate.
  - **Budget: USD 2.30 for the phase-8 campaign**: USD 1.00 for the Haiku campaign and USD 1.30 for the Sonnet confirmation. The per-run stop of USD 1.00 applies to issue runs, not to the full phase-PR run. Missing keys or an exhausted allowance leave coverage pending, never passed.
- Verify setup examples with the owner's supported clients and check `/mcp` at the required widths/themes. Include a text-only client path; no MCP Apps prerequisite.

## Out of Scope

- Owner administration/authentication, chat generation, RAG/embeddings/ingest, graph, ontology and external interactive UI.
- Model keys in this app, a direct database connection or duplicate read-tool implementations.

## Further Notes

- This phase can be accepted with structured API reads alone. Later RAG extends its capabilities without replacing this boundary.
