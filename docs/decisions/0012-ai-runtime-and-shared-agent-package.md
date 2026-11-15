# 0012 — Separate AI runtime, public MCP and shared Python agent package

Status: accepted (supersedes 0011's deployment layout)
Date: 2026-11-15

## Decision

- `apps/mcp-admin` remains TypeScript and uses the private content API with the caller's key.
- `apps/mcp-public` is a separate Python MCP deployable and calls the public read-capability interface of `apps/ai-service`.
- `apps/ai-service` is the FastAPI runtime with its own AI routes and internal authenticated generation endpoint.
- `packages/llm-agent` is the Python library for shared read tools, pipelines, model integrations, guardrails and evals. It is installed in Python app images, not deployed as a service. Use `src/llm_agent` and responsibility folders, including plural `pipelines`.
- Chat uses the same read implementations internally. Public MCP returns data to external agents; it does not run our models or chat pipeline. Only the TypeScript API backend accesses persistence and authorizes content writes.
- Chat has three stages: Security Gateway (rules and cheap classification model), Main Agent (bounded tools loop) and Output Guard (deterministic, no LLM). LangGraph orchestrates, LangChain integrates OpenAI/Anthropic, and Pydantic validates contracts.
- Retain Promptfoo and Langfuse from 0011; add explicit pytest coverage, code/model graders and human review. The phase-7 PRD specifies runtime limits, context management, spend reservations, cancellation, idempotency, redacted traces and failure behaviour.

## Why

Separate transport/lifecycle responsibilities keep the two MCP threat models clear while the Python package keeps read capabilities consistent. FastAPI provides an explicit AI interface apart from the web/content API. The package has small documented entries and responsibility folders; it does not grow into a generic agent platform.

Read-only tools limit what an injection can do. Input classification, evidence handling, deterministic output checks and measured adversarial/human evaluation address answer quality without claiming perfect security. Buffering generation until validation prevents unapproved tokens reaching the visitor.

## Rejected

- Keeping public MCP and chat transport in one `apps/llm-agent` deployable: superseded by the owner's requested separation.
- Running the Python package as if a workspace folder supplied a runtime: apps own servers, process lifecycle and Docker images.
- Sending admin writes through FastAPI: adds a proxy and duplicate authorization without an AI use case.
- Separate implementations of read tools for chat and MCP: capability implementations belong to the shared package.
- An LLM output-filter stage or a distributed AI platform: outside this portfolio chatbot's agreed scope.

## Consequences

Phase 7 delivers two Python images and their package/task integration. There is an extra HTTP hop for public MCP. The content API remains canonical; FastAPI has a separate AI OpenAPI contract. Initial concurrency is bounded within one AI-service generation process; adding replicas requires revisiting admission. Model/provider/tool/prompt changes require the relevant evals, with human review for ambiguous outcomes. Retrieval ownership and phase numbering remain as specified in phase 6.
