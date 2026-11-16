---
paths:
  - "scripts/checks/**"
---

# Repository checks

Before changing a repository check, read "The hard-coded configuration check" in `docs/repository-structure.md` and the Tooling row of `docs/testing.md`.

- The checks stay plain Node with no dependencies; `node --test scripts/checks/` and `node scripts/checks/hardcoded-config.mjs` work without `pnpm install`.
- A new spelling the check should catch starts with a failing fixture in `scripts/checks/fixtures/hardcoded-config/rejected/` and a case in `scripts/checks/hardcoded-config.test.mjs`.
- The CI commit-message check (`scripts/checks/commit-messages.mjs`) imports its rule from `harness/lib/commit-message.mjs`, so the `commit-msg` hook and CI stay one rule; a rule change starts with a failing case in `harness/lib/commit-message.test.mjs` or `scripts/checks/commit-messages.test.mjs`. Its event rules are in "What CI validates" in `docs/git-workflow.md`.
- There is no inline suppression and no excluded runtime or harness directory. Do not add one to make the check pass.
