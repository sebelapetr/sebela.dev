<!--
Title: Conventional Commits, for example `feat(api): add experience endpoints`.
An issue pull request is squash-merged, so its title becomes the commit message.
Rules: docs/git-workflow.md. Delete sections that do not apply.
-->

Closes #<!-- issue number; "Part of #N" when this does not finish it -->

## Summary

<!--
Phase pull requests (phase/<phase-folder> into master) only: one paragraph on what the phase delivers.
The release notes quote its first paragraph as the phase's highlight.
-->

## What changed

<!-- Two or three sentences, or a short list. -->

## How it was tested

<!--
- Test-first (security, API contracts, services, domain logic, bug fixes): the commit with the failing test, then the one that makes it pass.
- Evals-first (MCP and AI behaviour): the cases, the pass threshold and the result; paid runs with their cost.
- UI: screenshots at 360, 768 and 1280 px, light and dark.
- The checks you ran: pnpm lint, pnpm typecheck, pnpm test, pnpm build, or the narrower commands.
See docs/testing.md.
-->

## Docs updated

<!-- Which documents, AGENTS.md files or module maps changed with the behaviour, or "none needed" and why. -->

## Roles

<!-- Required (docs/git-workflow.md). Issue pull requests from the phase loop also name `Orchestrated by:`. -->

Implemented by:
Reviewed by:
Approved by:
