---
paths:
  - "compose.yaml"
  - ".env.example"
  - ".env.secrets.example"
---

# Local infrastructure

Before changing the Compose stack or the example environment, read "Ports and worktree isolation", "The shared Postgres", "The container API stack" and "Configuration and environment" in `docs/repository-structure.md`, "Container stack" and "Configuration" in `apps/api/AGENTS.md`, and Hooks and Environment files in `docs/permissions.md` for environment file access.

- `.env.example` lists every setting and `.env.secrets.example` every owner's secret for an outside service, each with a comment, as documented examples and placeholders only, never credentials or real data.
- The owner's `.env.secrets` exists only in the main checkout; never read, edit or name it. A command that needs a secret runs through `node harness/with-secrets.mjs -- <command>`.
- Ports, hosts and database names come from the environment; nothing executable carries a fallback copy of them.
- Read and edit `.env.local` only inside your own worktree; every other environment file is off limits.
