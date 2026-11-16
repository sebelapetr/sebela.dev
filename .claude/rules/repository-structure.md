# Repository structure

Before creating a new file, folder, package or app, read `docs/repository-structure.md`. It defines where things live, the package dependency rules and the port scheme.

The rules that are most often broken:

- `apps/web`, `apps/mcp-admin` and `apps/ai-service` reach data only through the API over HTTP. They never import `@sebela/db` or `@sebela/services`, and the Python apps/package have no database access at all. `apps/mcp-public` uses FastAPI read capabilities; `packages/llm-agent` is a library, not a service.
- Never hard-code a port, host or database name. Read them from the environment; each worktree has its own values in `.env.local`.
- The repository contains only the fictional demo seed. Never commit the owner's real data, and never copy anything from `.context/` into tracked files.
- Do not add a new top-level folder, app or package that is not in `docs/repository-structure.md` without the owner's approval. If the structure changes, update that document in the same change.
- Code, docs and PRDs are written in English.
