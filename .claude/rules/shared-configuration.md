---
paths:
  - "packages/config/**"
  - "**/eslint.config.js"
  - "**/prettier.config.js"
  - "**/.prettierignore"
  - "**/tsconfig*.json"
---

# Shared configuration

Before changing lint, TypeScript or Prettier configuration, read `packages/config/AGENTS.md`, the Formatting and lint and TypeScript sections of `docs/code-standards.md`, and the dependency rules in `docs/repository-structure.md` (including the `sebela/import-boundaries` lint rule).

- A change here changes every consumer: run the root `pnpm lint` and `pnpm typecheck`, not only this package's tasks.
- Rule sets and compiler checks are tightened, not loosened. Disabling a rule or a check, inline or in configuration, needs the owner's approval.
- A change to the dependency table changes `DEPENDENCIES` in `packages/config/import-boundaries.js` and its tests in the same pull request; new rule behaviour starts with a failing test.
- Prettier is configured only through the root `prettier.config.js`, which re-exports `@sebela/config/prettier`.
