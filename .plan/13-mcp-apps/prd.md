# Phase 13 — Interactive UI for external MCP clients

|            |                                                                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Status     | Draft, revised after the owner's architecture discussion; awaiting document approval                                                   |
| Date       | 2026-11-17                                                                                                                             |
| Parent     | `.plan/00-overview/prd.md`                                                                                                             |
| Depends on | Phases 8 and 10; independent of graph/ontology delivery                                                                                |
| Result     | Supported external MCP clients can display safe interactive views over existing read capabilities, retaining structured/text fallbacks |

## Problem Statement

Public MCP already provides useful structured data and sources. Some external clients may also render richer views, but client support and UI isolation need their own investigation. This must not delay the first public release or complicate the initial transport.

## Solution

Evaluate the current MCP Apps extension and deliver a small curated external UI over the existing public read tools. This phase is separate from the website's typed chat cards, which already exist.

## User Stories

1. In a verified compatible client, a visitor sees a useful contact, experience or service view.
2. A client without the extension still gets the same structured result and a text fallback.
3. A visitor cannot use a rendered view to access administration, generation or private knowledge originals.

## Implementation Decisions

- Begin with a bounded compatibility/security spike against current official MCP Apps and target-client documentation. Verify actual clients; do not assume support or require this extension for ordinary MCP use.
- Reuse existing read contracts. UI resources are application-owned reviewed code, never HTML/JavaScript supplied by model output, retrieved documents or arbitrary URLs.
- Specify sandbox, CSP, host/resource allowlists, validated messages, navigation/contact actions, payload limits and no secret-bearing browser state. A view has no additional tool authority.
- No admin credential, filesystem, arbitrary network fetch, raw original download or chat-generation access. Continue to validate outputs and source references at server boundaries.
- Share website components only if the spike demonstrates a simple safe fit; separate curated views are acceptable. No component-sharing framework is required.
- Keep text/structured compatibility tests and setup-page instructions accurate. Update deployment/assets only for verified requirements; adding a new app is a separate owner decision.

## Testing Decisions

- Verify isolation and forbidden actions with adversarial fictional payloads, malformed messages, hostile links, source text masquerading as UI and attempted privilege escalation.
- Test one complete view in supported clients and the unchanged fallback in a non-UI client; include accessibility and responsive checks appropriate to the host.
- No model call is needed to test deterministic rendering/security. Re-run affected public-tool evals and document the verified client/version matrix.

## Out of Scope

- Admin MCP UI, arbitrary model-generated applications, replacing website chat cards or making interactive UI a first-launch requirement.

## Further Notes

- Phase number indicates a later roadmap item, not a dependency on ontology. It may be scheduled independently after launch once its own prerequisites are met.
