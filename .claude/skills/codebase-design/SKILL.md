---
name: codebase-design
description: Use when designing or changing a module interface, deciding what behaviour to hide, reviewing private imports or mapping backend responsibilities in this repository.
---

# Codebase design

Use this as a reference for the current task. Read the relevant app/package map and the canonical [deep-module standard](../../../docs/code-standards.md#deep-modules), [placement/import rules](../../../docs/repository-structure.md#backend-module-layout) and [responsibilities](../../../docs/architecture.md#module-responsibilities-and-composition). Existing approved issue scope and repository vocabulary remain authoritative.

## Shape one complete operation

Describe the caller's operation, the decisions it removes, inputs/result, errors, side effects, atomicity, ordering and configuration. The interface includes these guarantees, not just a TypeScript signature. Keep the caller's required knowledge small; internal helpers may be small too.

For example, updating an experience with its technology relations is one profile operation. Services own domain orchestration; db owns the atomic persistence operation. The HTTP caller learns the input/result and failure guarantees, not SQL transaction handles or join-table update order. See the canonical example rather than inventing a second implementation here.

## Place and verify it

- Handwritten backend modules live at `src/modules/<name>/index.ts`. Cross-module callers use that entry; cross-package callers use declared exports. Private helpers/drivers stay private and module dependencies stay acyclic.
- Keep HTTP/security in the API, domain coordination in services and SQL in db. Contracts remain independent. Hide query builders, transactions and provider SDK objects. Compose validated configuration/resources once; do not create hidden runtime clients.
- Retain required HTTP, security and package adapters even with one implementation. Add replaceable-driver abstractions for actual variation such as local/Bunny storage. If removing a wrapper only removes forwarding code, simplify it; do not remove the trust boundary.
- Exercise operations through their observable contract with [tdd](../tdd/SKILL.md). Meaningful internal pure helpers may have focused tests without becoming public exports. A persistence mutation performs its documented side effect; return its result/errors rather than pretending all operations are pure.
- Update the module map with entry, responsibility, dependencies and relevant tests. Consult internals when this task needs them; directory depth is not module depth or proof of better AI performance.

Finish when the current interface decisions are clear. This reference does not start an architecture survey, spawn agents, add dependencies or ask for approval already supplied by the issue.

## Source and adaptations

Adapted from [Matt Pocock's reference](https://github.com/mattpocock/skills/blob/5863806dd4e15c63174bee4e7515a4256792ecfa/skills/engineering/codebase-design/SKILL.md), MIT; notice in [LICENSE](LICENSE). Unlike upstream, retain API/service/component/trust-boundary terminology, required single-implementation adapters, documented mutations and focused pure-helper tests. This repository chooses `modules/`; the folder name is not the underlying design principle.
