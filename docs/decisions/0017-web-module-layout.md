# 0017 — The website uses the module layout beside its routes

Status: accepted
Date: 2026-11-17

## Decision

`apps/web` keeps Next's file-based routing in `src/app/` and keeps those route files thin: metadata, `notFound()`, the request, and rendering a page template. Everything else lives in `src/modules/<name>/`, entered only through `index.ts` or `index.tsx`, as in the backend. Inside a module the folder names are fixed and created when they have content: `templates/`, `components/`, `data/`, `types/`, `hooks/`, `stores/`. What at least two modules or routes share lives in the module `_shared`. The details are in [repository structure](../repository-structure.md#web-module-layout).

## Why

- The first website issue (#42) placed its modules directly under `src/`, because the module layout was written for the backend and exempted Next.js. The `sebela/import-boundaries` rule recognises a module only at `src/modules/<name>/`, so nothing protected those modules' private files or checked cycles between them.
- Nineteen more issues add pages and capabilities to the website. One place for modules, checked by the existing rule, keeps the folder readable and gives agents the same reading path as in the backend: module map, entry, tests, implementation.
- Thin routes keep framework concerns apart from page content, so a page's composition can be read and changed without touching routing.
- `data/` instead of `services/`: "Service" is a domain term with its own page and module, and `@sebela/services` is a package the website may not import.

## Rejected

- **Modules directly under `src/`.** Works, but is unchecked by the lint rule and mixes modules with loose files.
- **A second module root or a changed lint rule for the website.** One convention and one rule for every TypeScript member is simpler.
- **`templates/index.tsx` as a second public entry.** A module has one entry; it exports its page template.
- **Scaffolding every folder in every module.** Empty folders describe nothing; the names are a vocabulary, not a checklist.
