# Phase 04 — AI Roadmap: handoff

The record of what phase 04 delivered against the [PRD](prd.md)'s 24 user stories, which issue pull request delivered each, and what is left for later phases. Only the owner merges `phase/04-ai-roadmap` into `master`.

## Issue pull requests

Each issue was implemented, reviewed and squash-merged into `phase/04-ai-roadmap`. Checks are the pull request's CI checks at merge time.

| Issue | Pull request                                                        | Scope                                                                                             | Checks        |
| ----- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------- |
| #109  | [#160](https://github.com/sebelapetr/sebela.dev/pull/160)           | Roadmap domain (areas, modules, resources), overview page, seed                                   | 9 of 9 passed |
| #110  | [#162](https://github.com/sebelapetr/sebela.dev/pull/162)           | Area and module pages, homepage Exploring, chat roadmap evidence                                  | 9 of 9 passed |
| #111  | [#163](https://github.com/sebelapetr/sebela.dev/pull/163)           | Learning diary, Prague days, time entries split at midnight                                       | 9 of 9 passed |
| #112  | [#164](https://github.com/sebelapetr/sebela.dev/pull/164)           | Bookshelf and book pages, covers                                                                  | 9 of 9 passed |
| #113  | [#166](https://github.com/sebelapetr/sebela.dev/pull/166)           | Events page, event attendance and event time in the diary                                         | 9 of 9 passed |
| #114  | [#167](https://github.com/sebelapetr/sebela.dev/pull/167)           | Learning statistics                                                                               | 9 of 9 passed |
| #115  | Branch `feat/115-roadmap-supporting-content` (pull request pending) | Supporting content, reading guide, full metadata and discovery, launch import checklist, journeys | Pending CI    |

The documentation-only pull requests #161, #165 and #168 kept the README in step and are not issue pull requests.

## User stories

| #   | Story (short)                                            | Delivered by          | Where                                                                                                                                                      |
| --- | -------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Areas with their modules and progress                    | #109                  | `/ai-roadmap`; progress derived by the API                                                                                                                 |
| 2   | Area page with modules, module page with resources       | #110                  | `/ai-roadmap/<area>`, `/ai-roadmap/<area>/<module>`                                                                                                        |
| 3   | Which areas are current                                  | #109, #110            | Overview and area status; homepage Exploring                                                                                                               |
| 4   | Totals and last update                                   | #109                  | Overview heading block (counts, planned hours, last update)                                                                                                |
| 5   | Diary day by day with time spent                         | #111                  | `/ai-roadmap/diary`                                                                                                                                        |
| 6   | A single day with notes and what was studied when        | #111, #113            | `/ai-roadmap/diary/<date>`, including events covering the day                                                                                              |
| 7   | Statistics of time spent                                 | #114                  | `/ai-roadmap/diary/stats`                                                                                                                                  |
| 8   | Bookshelf and book summaries                             | #112                  | `/ai-roadmap/bookshelf`, `/ai-roadmap/bookshelf/<book>`                                                                                                    |
| 9   | Events attended with takeaways                           | #113                  | `/ai-roadmap/events`                                                                                                                                       |
| 10  | FAQ, additional terms, sources, project ideas, guide     | #115                  | Overview supporting sections (project ideas, followed sources and terms from the API; FAQ as static text) and `/ai-roadmap/how-to-read-effectively`        |
| 11  | Sub-navigation inside the AI Roadmap                     | #109–#115             | On every roadmap page, absent elsewhere (`e2e/supporting-content.spec.ts`)                                                                                 |
| 12  | Link to the rest of the site instead of an About page    | #109, #115            | "Who's building this" links to the homepage; no separate-site identity left                                                                                |
| 13  | Works at a narrow width                                  | All                   | Screenshots at 360, 768 and 1280 px, light and dark, in each pull request                                                                                  |
| 14  | Homepage Exploring shows what is in progress             | #110                  | Homepage Now/Exploring reads the roadmap's current modules                                                                                                 |
| 15  | Chat sources can point at roadmap items                  | #110, #115            | Mock chat roadmap card and source lead to the module page (`e2e/roadmap.spec.ts`); live AI is phases 6 and 7                                               |
| 16  | All existing data imported                               | #115 (interface only) | Seed format covers the whole domain; launch import interface and checklist in `packages/db/seed/README.md`. The import itself is a later phase (see below) |
| 17  | Keep logging in the old app, import once at launch       | #115 (interface only) | One-time import, no synchronization or reconciliation (`docs/domain-context.md`, Launch import and later phases)                                           |
| 18  | Record time at an event like time on a resource          | #113                  | Time entries reference a resource or an event                                                                                                              |
| 19  | Progress, completion dates and totals worked out         | #109–#114             | Derived by the services, never stored by hand                                                                                                              |
| 20  | Add entries, resources, books and events via the API     | #109–#115             | Private, API-key-protected write routes with OpenAPI operations and generated client methods, including supporting content                                 |
| 21  | Structured data and good titles for search               | #110, #112, #115      | Every roadmap page: title, description, canonical, Open Graph image, JSON-LD (`apps/web/AGENTS.md`, Metadata and indexing)                                 |
| 22  | `llms.txt` covers the roadmap                            | #115                  | Overview, areas, modules, diary, statistics, events, bookshelf, books, reading guide (diary days are in the sitemap only)                                  |
| 23  | Demo seed with a fictional roadmap, diary, books, events | #109–#115             | `packages/db/seed/demo`: hierarchy, several weeks of diary, books with covers, events and supporting content; a second run changes nothing                 |
| 24  | Carried-over pages compared against the original         | Each issue            | Side-by-side comparison with equivalent fictional data; intended differences recorded in `docs/design.md` (AI Roadmap)                                     |

## Left for later phases

- **The real launch import.** Issue #115 says the actual import, the owner's data, the conversion mapper and the real reconciliation report belong to **phase 8**. The [PRD](prd.md) (Implementation Decisions and Out of Scope) and [issues.md](issues.md) say **phase 10**, and the [overview](../00-overview/prd.md) places launch after phase 10 (`10-delivery`); phase 8 is the public MCP server. The repository documents the import without naming a phase. **The owner should decide which is meant.**
- **The diary-entry replacement** is phase 5 (admin MCP). Its extension points are in `docs/domain-context.md` and `apps/web/AGENTS.md`.
- **Knowledge and chat sources** (phases 6 and 7) can name a roadmap record by kind and slug; the targets are listed in the same documents.

## Notes for the owner

- **Supporting content is not a page of its own.** Project ideas, followed sources and terms live on the overview, so the sitemap and `llms.txt` list the overview and the reading guide, not each supporting record. No listing pages, filtering or search were added.
- **The original's FAQ structured data (`QAPage`) was not carried over;** the overview keeps `ItemList` of areas. The FAQ drops the original's hard-coded counts so it cannot go stale.
- **Fixed during #115:** a unit test of the roadmap detail read (`load-roadmap-detail.test.ts`) could hang because a never-answered fake request was garbage-collected with its abort listener; the test now keeps its pending requests in a module-level set until their timeout aborts them. Only the test changed, not the website's behaviour.
- **Visual approval** of the carried-over pages is the owner's, separate from the approval of the issue breakdown.
- **Failures found in review and fixed in #115:** the browser suite's Open Graph check still expected `/og/ai-roadmap` to have no preview, which #115 adds; it now checks a roadmap address without a card. Dropped-notification recovery is now also tested for the supporting content and for pages entering and leaving the sitemap and `llms.txt` (`apps/web/e2e/cache-recovery.spec.ts`).
- **Open checks:** the #115 pull request's CI and the reviewer's full browser-suite run. Report any failure there as unresolved; a phase loop that finds no eligible issues does not mean the phase is complete.
