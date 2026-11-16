---
paths:
  - "compose.yaml"
  - ".env.example"
---

# Local infrastructure

Before changing the Compose stack or the example environment, read "Ports and worktree isolation", "The shared Postgres" and "Configuration and environment" in `docs/repository-structure.md`, and Hooks in `docs/permissions.md` for environment file access.

- `.env.example` lists every variable with a comment and holds documented examples and placeholders only, never credentials or real data.
- Ports, hosts and database names come from the environment; nothing executable carries a fallback copy of them.
- Read and edit `.env.local` only inside your own worktree; every other environment file is off limits.
