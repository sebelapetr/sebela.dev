# Phase 9 — Additional issues

Source: [RAG PRD](prd.md). On 2026-11-20 the owner requested one additional issue to make the available public knowledge MCP more prominent on the website.

This index records that approved addition, **not a complete breakdown or approval of the phase-9 draft**. The remaining RAG implementation issues still need their own approved breakdown.

| Issue                                                       | Title                                                                      | Type | Blocked by                                                                                                                                    | Phase 9 user stories |
| ----------------------------------------------------------- | -------------------------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| [#218](https://github.com/sebelapetr/sebela.dev/issues/218) | Promote the public knowledge MCP across the website and explain RAG search | AFK  | Phase 8 public MCP and `/mcp` setup/discovery; phase 9 accepted public MCP/search integration and source contracts; prerequisite owner merges | 1, 5, 7              |

## Execution notes

- #218 carries `phase:09-rag`, `afk`, `enhancement` and `ready-for-agent`. Readiness labels do not remove its prerequisites: do not begin until the existing public MCP/setup and phase-9 search integration are implemented and accepted. Replace the capability-level blockers with concrete issue references when the phase-8/9 breakdowns are published. This issue belongs within phase 9 and does not depend on phase 9 as a whole closing first.
- Phase 8 already owns the public MCP adapter, setup page, verified remote client examples and basic links from navigation/homepage/chat. #218 makes the benefit more visible and explains the later RAG capability; it consumes those interfaces and does not recreate the server or search implementation.
- The complete visitor journey is homepage or `/ask` -> `/mcp` -> canonical copyable connection guidance and source-backed question examples. Tests and screenshots belong to the presentation slice; it reuses the accepted tool contracts/evals and needs no paid calls to render or test the guidance.
- Do not run this slice concurrently with changes to shared navigation/footer, homepage/chat composition, `/mcp`, discovery metadata, `llms.txt` or README without assigning disjoint ownership. The phase loop is sequential; a shared-file collision is not permission to overwrite another issue's edits.
- Public promotion covers public facts and approved passages only. Admin MCP, conversations, pending imports and original documents remain outside the advertised surface. No new app/package, public ingest or visitor-memory product is introduced.
- Publication starts no feature implementation or unattended phase loop. Use the normal issue branch/worktree/PR into `phase/09-rag` when prerequisites are ready; only the owner merges the phase into `master`.
