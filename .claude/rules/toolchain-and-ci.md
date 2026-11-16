---
paths:
  - "**/package.json"
  - "pnpm-workspace.yaml"
  - "pnpm-lock.yaml"
  - "turbo.json"
  - ".nvmrc"
  - ".github/workflows/**"
---

# Toolchain and CI

Before changing the workspace, its tasks or CI, read "Toolchain and workspace" and "Root commands" in `docs/repository-structure.md`, the CI section of `docs/testing.md`, and Dependencies in `docs/code-standards.md`.

- Shared tool versions live once in the `catalog` of `pnpm-workspace.yaml`; packages use `catalog:` and `workspace:*`. Commit the updated lockfile with any dependency change, and state why a new dependency is needed.
- A package defines only the tasks it can meaningfully run. Packages and scripts are not created to give a task something to do.
- CI runs the same root commands as contributors. A failing check is fixed, never disabled or skipped.
- The root `prepare` script enables the Git hooks; keep it when changing the root scripts.
