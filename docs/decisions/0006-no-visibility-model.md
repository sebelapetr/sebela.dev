# 0006 — No visibility model until a use case needs it

Status: accepted (its mention of a JWT is superseded by 0009)
Date: 2026-11-15

## Decision

Content records have no visibility field. Everything in the database is public. The API has public read routes and private routes protected by a JWT; every write is private. There are no token scopes.

## Why

The profile is public by nature. A visibility field on every entity, a filter in the service layer and tests for it would solve a problem that does not exist for a site of this size. The trust boundary still holds: writing requires a token that only server-side callers have.

## Rejected

- **Public and private on every record, with a private-read scope.** Planned at first for diary notes and client data; deferred until such content actually exists, and then added only where needed.
