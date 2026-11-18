# Deep modules

Before shaping a module, read the Deep modules section of `docs/code-standards.md`, Backend module layout (and Web module layout for `apps/web`) in `docs/repository-structure.md`, Module responsibilities and composition in `docs/architecture.md`, and the relevant app/package `AGENTS.md`.

State the caller's complete operation, guarantees/errors and the decisions it hides. Handwritten backend modules and the website's modules use `src/modules/<name>/index.ts`; website routes in `src/app/` stay thin and render a module's template; other modules use that entry and other packages use declared exports. Keep dependencies acyclic, private files private, and SQL/driver details behind their owners. Preserve the API trust boundary and maintain the module map.

Read `.claude/skills/codebase-design/SKILL.md` when designing an interface and `.claude/skills/tdd/SKILL.md` for test-first implementation. These are project-local references, not permission to expand scope or restart an approved design process. Required HTTP/security adapters remain useful; folder nesting and forwarding wrappers alone do not create deep modules.
