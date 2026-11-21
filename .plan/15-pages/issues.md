# Phase 15 — Issues (draft)

Source: [Pages PRD](prd.md), with the owner's decisions of 2026-11-21 applied (footer flag `inFooter`, "Last updated" from `updatedAt`, a new schema for site content, no content pages in `/llms.txt`). **Draft: not published. The issues are published with the `to-issues` skill once the owner approves this breakdown.**

Prerequisite: the phase 6 pull request (#274) is merged into `master` by the owner before this phase starts.

| Issue | Title                                                                                       | Type | Blocked by |
| ----- | ------------------------------------------------------------------------------------------- | ---- | ---------- |
| TBD   | Store and serve content pages: schema, public reads, private writes, client and a demo page | AFK  | None       |
| TBD   | Manage content pages through Admin MCP as the `page` entity, evals first                    | AFK  | 1          |
| TBD   | Render content pages at `/<slug>` with a footer link and sitemap entry                      | AFK  | 1          |

1. **API slice.** The `pages` module in the database package, services, contracts and API; migration in the new schema for site content; the fields `slug`, `title`, `body` and `inFooter` (default `false`); reserved slugs; audit and invalidation domain `page` (mapped in the website's dependency map so it compiles); regenerated OpenAPI document and API client; a fictional privacy page in the demo seed, marked for the footer, covered by the seed loader and content clearing; glossary, domain context and the API's module map. Test-first.
2. **Admin MCP slice.** The eval cases and their fixture first, then `page` in the entity registry (its description covers `inFooter`) and the content-pages section of the `update-profile` skill; deterministic tests and one end-to-end path; module map. Gate: the PRD's thresholds on the affected cases.
3. **Website slice.** The `pages` module and the thin `/<slug>` route, the safe Markdown subset with headings, a footer row for each page marked with `inFooter` (the API's fixed order, no other navigation), the sitemap entry, `/llms.txt` unchanged, metadata; unit and Playwright tests; screenshots at 360, 768 and 1280 px in light and dark; `docs/design.md` and the website's module map. Its acceptance references #189: with this merged and deployed, the owner enters the real privacy page through Admin MCP, which closes #189.

Slices 2 and 3 are independent of each other. The phase runs after phase 6 (#274) is merged into `master` and beside phase 7; whichever of the two phases merges second merges `master` and regenerates the API clients (PRD, Sequencing).
