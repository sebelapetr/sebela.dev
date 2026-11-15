# 0004 — Agents by role, knowledge in per-part AGENTS.md

Status: accepted
Date: 2026-11-15

## Decision

Six agents, one per role: orchestrator, backend-developer, frontend-developer, ai-developer, reviewer, docs-keeper. Every app and package has its own `AGENTS.md` with what is specific to it. There are no `CLAUDE.md` files.

## Why

Parts of the codebase differ in knowledge, not in role. Knowledge kept next to the code is read by whichever agent works there and is maintained in one place.

## Rejected

- **A developer and a reviewer agent per app and package.** Around twenty near-identical definitions that would drift apart.
