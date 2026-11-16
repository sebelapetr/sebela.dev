---
paths:
  - "scripts/checks/**"
---

# Repository checks

Before changing a repository check, read "The hard-coded configuration check" in `docs/repository-structure.md` and the Tooling row of `docs/testing.md`.

- The checks stay plain Node with no dependencies; `node --test scripts/checks/` and `node scripts/checks/hardcoded-config.mjs` work without `pnpm install`.
- A new spelling the check should catch starts with a failing fixture in `scripts/checks/fixtures/hardcoded-config/rejected/` and a case in `scripts/checks/hardcoded-config.test.mjs`.
- There is no inline suppression and no excluded runtime or harness directory. Do not add one to make the check pass.
