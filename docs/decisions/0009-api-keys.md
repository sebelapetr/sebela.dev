# 0009 — API keys, hashed in the database, instead of JWTs

Status: accepted (supersedes the JWT part of 0006)
Date: 2026-11-15

## Decision

Private API routes are protected by API keys. A key is created with a command, shown once and stored only as a hash, with a name. Keys do not expire by themselves and are revoked individually. The admin MCP server holds no key: it passes on the key its caller presents.

## Why

Callers are long-running agent connections. A token with an expiry breaks them in the middle of work and adds a renewal problem with no benefit for a single owner. Individually revocable, named keys give the control that matters: knowing which caller holds which key and being able to cut one off.

## Rejected

- **JWT signed with a shared secret, with an expiry.** Expiry interrupts agents; invalidating one token means rotating the secret and invalidating all.
- **OAuth for the admin MCP server.** Needed only for clients that cannot send a header (the claude.ai apps). Left as a later addition.
