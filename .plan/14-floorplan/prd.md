# Phase 14 — Floorplan: a public map of the architecture

|            |                                                                                                                            |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| Status     | Draft from the owner's request (2026-11-20); awaiting owner approval                                                       |
| Date       | 2026-11-20                                                                                                                 |
| Parent     | `.plan/00-overview/prd.md`                                                                                                 |
| Depends on | None. Independent of the other open phases                                                                                 |
| Result     | A reviewed, tracked source of an interactive architecture map, a repeatable export, and the map published as a static page |

## Problem Statement

The repository is part of the portfolio, and an employer opening it meets 700+ code files across three apps and six packages. `docs/architecture.md` and the module maps in each `AGENTS.md` explain the structure in prose, but nothing lets a newcomer see in a minute how the website, the API, the services, the database and the MCP server fit together, which file does what, and how one request travels through them.

A first interactive map (the Floorplan tool: subsystems, files and routes as named cards joined by the imports and HTTP calls between them) was generated locally on 2026-11-20. It works, but it exists only in an ignored folder, most descriptions are copied from code comments or templated, and nothing keeps it current.

## Solution

Keep the map's hand-edited sources in the repository, regenerate and publish a read-only export on demand, and refresh it at the end of each phase.

```text
docs/floorplan/architecture.json + descriptions/*.json   (tracked, reviewed in pull requests)
        -> sync into the ignored working folder floorplan/ -> Floorplan build
        -> export (single self-contained HTML, no Ask bar, no local paths, no health list)
        -> static page on a subdomain; linked from README.md
```

## User Stories

1. As an employer, I want to open one page and see how the application is built, so that I understand the system without reading the code first.
2. As an employer, I want every card to carry a plain, accurate name and one-line description, so that I can pick the file worth opening.
3. As the owner, I want the sources of the map reviewed and versioned like the docs, so that the portfolio never shows an unreviewed or stale claim.
4. As the owner, I want one command to turn the tracked sources into the publishable export, so that publishing is not manual work.
5. As the owner, I want the map refreshed when a phase merges, so that it follows the code without a separate project.
6. As the owner, I want nothing private on the public page: no local paths, no remotes, no health list of public endpoints and secret locations.

## Implementation Decisions

### Where things live

- Tracked sources: `docs/floorplan/architecture.json` and `docs/floorplan/descriptions/*.json`. Documented in `docs/repository-structure.md`; no new top-level folder.
- The tool writes its working files into `floorplan/` and gitignores the folder itself, so the generated `graph.json`, `index.html` and caches are never tracked. A small script (`scripts/floorplan.mjs`, plain Node) copies the sources in before a build and the edited sources back after an update, and runs the export.
- The tool is an external Claude plugin, not a repository dependency. Updating descriptions for new or changed files needs a model, so it is done by the owner or an agent at the end of a phase; CI does not run it.
- A decision record in `docs/decisions/` states the choice and the alternative that was rejected (tracking the generated HTML).

### Publishing

- The export is built with the tool's `--export` option with its defaults (flows and notes); `--include health` is never used for the public page.
- The export is served as a static file on a subdomain chosen by the owner and linked, with a screenshot, from `README.md`. Hosting and the subdomain are the owner's decision (HITL issue).

### Content quality

- Descriptions follow the tool's writing guide for developers: one sentence, verb first, what the code does today, no claim about who uses a thing unless the code shows it, placeholders called placeholders.
- Priority order for the rewrite: API routes and modules, services, Admin MCP tools, database schema, then the website's feature modules. Tests, configs and migrations keep short templated descriptions.
- The three "anyone could change data" health items of the first scan are checked against the code and either fixed or recorded as false positives; they are not published.

## Testing Decisions

- No UI work in this repository; the map is a generated artefact. The script gets Node tests (`node --test`) for the sync in both directions and for the export refusing to include the health list or a local path.
- A check that fails when `docs/floorplan/descriptions/` names a file or route that no longer exists is useful but depends on the tool's scan; it is optional and only added if the tool can run offline in CI.
- Acceptance is the owner opening the published page and finding the flows, the tour and a sample of descriptions correct.

## Out of Scope

- Running the Floorplan tool or any model in CI.
- A hosted Ask bar on the public page (it needs the Claude Code CLI on the server); the site's own chatbot already answers questions.
- Mapping docs, configuration, migrations' data or `.plan/` beyond what the first scan shows.
- Committing the generated `index.html` or `graph.json`.
