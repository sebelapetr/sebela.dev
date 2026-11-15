# 0002 — Hono and Drizzle for the backend

Status: accepted
Date: 2026-11-15

## Decision

`apps/api` is built with Hono. Database access uses Drizzle with generated, committed SQL migrations.

## Why

- Hono: small and readable; validation and the OpenAPI description come from the same Zod definitions; bearer authentication and streaming are built in; an MCP transport exists for it. The same stack already worked in the owner's Booky monorepo.
- Drizzle: schema in TypeScript with no generated client to keep in sync, which suits parallel agents; Zod schemas derive from tables; aggregations for diary statistics are natural to write; separate Postgres schemas per domain are supported.

## Rejected

- **Express:** widely known but brings nothing over Hono here; types, validation and OpenAPI would be assembled by hand.
- **NestJS:** a stronger signal for enterprise backend roles, but heavy for a small domain and slower for agents to work in.
- **Prisma:** more familiar and more widely used, but needs a generated client and falls back to raw SQL for the aggregations this project needs.
