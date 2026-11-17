# 0015 — A caller-scoped unit of work for loading a seed

Status: accepted
Date: 2026-11-16

## Decision

- `@sebela/db` exposes one caller-scoped unit of work: `Persistence.transaction(work)`. It runs `work` with a complete `ProfilePersistence` bound to one database transaction. It commits when `work` resolves and rolls back every write when `work` throws; the result or error passes through unchanged.
- Inside it, every profile persistence operation behaves as it does outside. An operation that opens its own transaction (an experience with its links, a project, a service with its evidence) runs as a savepoint: its refusal rolls back only its own statements, and its locks (`FOR KEY SHARE`, `FOR UPDATE`) are held until the outer transaction ends.
- Only services may use it, and only for a use case that must apply many complete profile operations as one: today, `SeedService.loadSeed`. The caller still receives persistence operations, never a transaction handle, SQL, a table or a driver error. HTTP routes and ordinary profile and media operations keep requesting one atomic persistence operation each.
- File storage stays outside the transaction. The seed stores files before it commits and removes them again when the transaction rolls back, as the media module does for a single upload.

## Why

- A seed load writes dozens of records across every profile entity. Acceptance requires that a failure after validation leaves no partial dataset, so the whole load must commit or roll back together.
- A single db operation "load this dataset" would move the seed's domain rules (matching by slug, case studies by project, media reuse, reference checks) into db, or duplicate the profile service's rules there. Running the existing profile and media services over a transaction-bound persistence reuses their validation and domain errors unchanged.
- The unit of work still hides the transaction mechanics: services pass a function and get domain results, so swapping the driver or the transaction strategy does not reach them.

## Rejected

- **A dataset-level persistence operation in db**: duplicates domain rules below services, or moves them there, and grows db by a second implementation of every entity's write.
- **Loading record by record without a transaction**: a failure halfway leaves a partially loaded profile that the next run has to repair; the issue requires no avoidable partial change.
- **Exposing the Drizzle transaction to services**: leaks SQL primitives across the persistence entry, which [code standards](../code-standards.md#deep-modules) forbids.
