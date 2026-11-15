# 0005 — Test-first where correctness matters, visual evidence for UI

Status: accepted
Date: 2026-11-15

## Decision

Test-first is mandatory for security, API contracts, services and bug fixes. MCP and AI features are evals-first. Layout, typography and responsive polish are accepted on acceptance criteria, Playwright checks, screenshots and visual review.

## Why

A blanket test-first rule slows down visual work without making it better: an assertion cannot judge typography. The project exists to ship a good product, not to demonstrate a methodology.

## Rejected

- **Test-first for everything, checked by the reviewer.** Clean as a process, costly for frontend work.
