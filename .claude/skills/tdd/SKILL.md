---
name: tdd
description: Use when implementing or fixing observable behaviour test-first in this repository, including security, API contracts, services, domain logic and frontend state or data mapping.
---

# Test-driven development

Follow [testing policy](../../../docs/testing.md), [domain vocabulary](../../../docs/domain-context.md) and the relevant app/package instructions. This is a project-local implementation reference. Use [codebase-design](../codebase-design/SKILL.md) when the interface itself needs design; neither reference starts an additional planning process.

## Choose the observable behaviour

Record the operation under test, its caller-visible result/errors and critical failure cases. An approved issue/PRD already establishes scope and test surfaces; proceed without asking for the same approval again. Ask only when a material domain/scope decision remains unresolved.

Use the smallest relevant public surface: HTTP for contracts/authentication, service operations for domain guarantees, persistence operations for atomicity and independently specified pure transformations for mapping. Do not write tests that merely mirror configuration, generated output or trivial forwarding. Delegating handlers still require their contract/security tests.

## Red → green → refactor

1. Write one behavioural test using fictional small fixtures and expected values from the requirement or a worked example, not a repeated implementation formula.
2. Run it and observe failure because the required behaviour is missing. Repair fixture/import errors before accepting the red evidence. Commit the failing test before implementing the behaviour.
3. Implement only enough for that slice, run the test and relevant regression checks, and verify the result.
4. Refactor after green without changing behaviour; keep the same observable tests passing. Continue one behaviour at a time rather than writing all tests, then all implementation.

For an experience mutation, first prove that replacing technologies returns the expected experience; separately prove that a failed replacement preserves the original experience/relations. Use the real service/persistence path and real Postgres, not assertions that a mocked repository was called.

## Test dependencies at their actual interfaces

Use dedicated temporary Postgres databases, never a database mock or the browser demo seed. Controlled clocks/randomness, disposable files and external provider fakes are useful where those dependencies vary. Do not mock every internal collaborator or assert private call order. Persistence-integrity tests may inspect the persistence contract; ordinary service/HTTP tests observe through their own operation.

Nontrivial internal pure helpers may have focused input/output tests without being exported solely for testing. UI layout/typography follows Playwright and six screenshot combinations; test-first still covers its logic. MCP/model/retrieval features remain evals-first with stated thresholds; deterministic tests supplement those evals.

Run the required affected checks and preserve CI gates. Review verifies meaningful red evidence and observable coverage, not test count.

## Source and adaptations

Adapted from [Matt Pocock's reference](https://github.com/mattpocock/skills/blob/5863806dd4e15c63174bee4e7515a4256792ecfa/skills/engineering/tdd/SKILL.md), MIT; notice in [LICENSE](LICENSE). Project adaptations preserve existing approval, require real Postgres, permit useful internal pure-helper tests and refactoring after green, and retain the UI/evals exceptions established by repository policy.
