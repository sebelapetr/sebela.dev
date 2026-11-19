# 0021 — The API audits every content write in the write's own transaction

Status: accepted
Date: 2026-11-19

## Decision

The API records an audit entry for every committed content write (issue #154). The entry is written in the same database transaction as the change itself.

- **Owner.** The audit is written by the API's owning backend operation (`AuditService.write` in `@sebela/services`), not by a client. Every write route that declares a content domain is registered through it. This covers MCP Admin, direct API clients and any later caller alike.
- **Atomic.** Content and audit commit together or not at all. If the audit cannot be stored, the content rolls back. A refused, invalid or failed write stores nothing, and reads never store anything.
- **Private store.** Entries live in their own `audit` schema (`audit.content_changes`), which is never a content entity. It is not part of the seed, the public routes or any generic content operation.
- **Verified actor.** The actor is the API key that authenticated the request, kept as a foreign key to `auth.api_keys`. No request field or header can set or change it.
- **Bounded provenance.** A caller may state a short label in the `sebela-provenance` header, for example `mcp-admin/update_content`. The label is lower case, follows a fixed pattern and has at most 64 characters. Anything else is refused before the write runs. The label is what the caller said. It is never proof of who acted or that a human approved.
- **Content of an entry.** Each entry holds:
  - the operation identifier, method and route template
  - the entity and record
  - `created`, `updated` or `deleted`
  - the record's public read before and after the change

  An entry never holds credentials, other headers or file bytes.

- **Serialized.** Audited writes take one transaction advisory lock, so the before and after each write reads belong to that write alone.
- **Read back.** The private `GET /v1/audit/changes` returns the newest 20 entries. A client that lost a write's response reads it before retrying, so it does not write twice.
- **Coverage is a test.** A route-walking test fails when a write route is registered without the audit.

## Why

- An audit that a client writes can be skipped, forged or lost. The API is the trust boundary (`docs/architecture.md`), so it is the only place that knows both the verified key and the committed result.
- A best-effort log written after the commit can disagree with the data. One transaction makes "changed" and "audited" the same fact.
- The website notification remains a best-effort signal after the commit. Its job is cache invalidation, and it is not a record of what happened.
- Snapshots of the public read reuse the contracts the API already guarantees. They need no new per-entity serialization, and private state stays out of the audit.
- Content writes are rare, owner-driven operations, so serializing them costs nothing noticeable. In return, a concurrent edit cannot be attributed to the wrong write.

## Rejected

- **Audit in MCP Admin.** It would miss direct API writes, and its actor would be whatever the client claimed.
- **Audit through the invalidation notification or another event platform.** Delivery is at least once and can be lost. A store of record cannot depend on it.
- **Database triggers.** A trigger has no access to the verified key, the operation or the provenance unless every connection first sets session state. The snapshots would also be raw rows, not the public read.
- **A free-form provenance or actor field in the request body.** It would be unbounded and forgeable, and a client could pass a credential or prompt text through it.
- **Automatic undo from the audit.** Out of scope for issue #154. Reverting a change is a new, explicit write.
