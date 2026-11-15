# 0001 — The API is the only gateway to data

Status: accepted
Date: 2026-11-15

## Decision

The website and both MCP servers reach data only through `apps/api` over HTTP. The backend is a separate app; Next.js is a frontend only.

## Why

The API is the trust boundary. The system has agent write access, two MCP servers with different threat models and a public chatbot. Enforcing authentication once, at one boundary, means no client can bypass them.

## Rejected

- **MCP servers calling shared services directly.** Fewer hops, but every client would have to apply the access rules correctly on its own.
- **API routes inside Next.js.** One deployable fewer, but the backend would be tied to the frontend framework while serving three other kinds of clients.
