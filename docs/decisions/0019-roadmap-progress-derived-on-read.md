# 0019 — Roadmap progress is derived on read

Status: accepted
Date: 2026-11-18

## Decision

The AI roadmap stores only areas, modules, resources and their topic links. The progress of a module, an area and the whole roadmap — the completed/all count, the derived status, the completion date, the last update and the summed estimates — is computed from the resource statuses on every read by a pure function (`packages/services/src/modules/roadmap/progress.ts`) and returned with the tree by `GET /v1/roadmap`. Nothing stores it. A write changes the stored records; the API's `onWrite` notifies the website with the content domains `roadmap-area`, `roadmap-module` and `roadmap-resource`, and the website refetches. The rules are in `docs/domain-context.md`, "Roadmap progress".

The original application's event bus, queue, Redis cache and slug registry are not carried over. Parents are real foreign keys without a cascade, slugs are unique per table, and the reserved area slugs are a database check.

## Why

- A stored count or status can disagree with the resources it summarises after a missed event, a partial failure or a manual repair. A value derived from the current rows cannot.
- The tree is small (tens of areas and modules, hundreds of resources at most) and is read in one snapshot, so deriving progress costs less than keeping a copy consistent. The website's cache and its invalidation already bound how often it is read.
- A pure function over plain values is tested exhaustively without a database, including the edge cases the PRD names: skipped resources only in the denominator, empty containers, all-skipped resources, empty modules within an area, completion dates and missing estimates.
- Foreign keys, a unique index and a check constraint give the same guarantees the event bus, queue and slug registry provided in the original application, inside one transaction and without another moving part to run.

## Rejected

- **Progress columns updated on every write, or by triggers.** They duplicate the resources and must be kept consistent through moves, deletions and seed reruns.
- **The original event bus, queue and Redis cache.** They exist to keep derived state and caches in step; with nothing derived stored and the website invalidated by `onWrite`, they have nothing to do.
- **A shared slug registry.** Slugs are unique per kind of record by the database; the few area slugs taken by roadmap pages are a constant list checked by the contract and the database.
- **Area weight or estimates as progress.** They are planned effort; showing them as completed work or logged time would misstate what was learned.
