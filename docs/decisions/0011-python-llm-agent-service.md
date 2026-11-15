# 0011 — One Python service for the AI layer; promptfoo and Langfuse

Status: superseded by 0012 (historically superseded the `mcp-public` and `packages/llm` parts of earlier plans)
Date: 2026-11-15

## Decision

The AI layer is one Python service, `apps/llm-agent`: FastAPI and LangGraph, containing the chat pipeline and the public read-only MCP server, which share one set of read tools. It reaches data only through the API's public routes. The API owns conversations (cookie, ownership, limits, budget, storage) and calls the assistant for answers. Evals use promptfoo; production monitoring uses Langfuse. `mcp-admin` stays in TypeScript.

## Why

- Job listings for AI engineering are dominated by Python, LangChain and LangGraph; the project is also evidence for such roles, and Python and FastAPI are on the owner's own roadmap.
- A chat agent in TypeScript and a public MCP server in Python would define the same read tools twice. One service defines them once.
- It mirrors a common real-world split: product backend in one language, AI service in Python.
- promptfoo is the most recognised CI-native eval tool and ships red-teaming tests that fit the forbidden-behaviour suites. Langfuse is open source and covers traces, cost and scoring of real conversations.

## Rejected

- **Chat pipeline in TypeScript on the Vercel AI SDK, with Evalite.** Least work and one language, but absent from what employers ask for, and it duplicates the tools.
- **LangGraph.js.** Keeps one language, but the JavaScript port is the less used one.
- **An agent framework on top (LangChain chains, Mastra).** The pipeline has five steps; a graph is enough.
