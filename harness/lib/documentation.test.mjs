// Which changed files are documentation, which never counts as a change of an app or package: the
// rule of the developer handoff hook (handoff.mjs) and of CI and the release plan
// (scripts/checks/without-documentation.mjs). The cases against the files of this repository that
// code reads are in scripts/checks/without-documentation.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isDocumentation } from "./documentation.mjs";

test("is Markdown anywhere, docs/ and .plan/", () => {
  for (const file of [
    "README.md",
    "CHANGELOG.md",
    "apps/api/AGENTS.md",
    "packages/db/seed/README.md",
    "packages/ui/docs/Notes.MD",
    "docs/testing.md",
    "docs/decisions/0001-example.md",
    "docs/images/diagram.svg",
    ".plan/07-chat/prd.md",
    ".plan/done/03-web/prototype/index.html",
    ".claude/rules/harness.md",
    ".claude/agents/reviewer.md",
    ".github/pull_request_template.md",
  ]) {
    assert.equal(isDocumentation(file), true, file);
  }
});

test("is everything in docs/ and .plan/, whatever a folder inside them is called", () => {
  // docs/evals/ holds the evaluation reports, not the inputs of an eval: a folder name that marks
  // Markdown code reads elsewhere says nothing inside the two documentation folders.
  for (const file of [
    "docs/evals/06-llm-agent.md",
    "docs/evals/grading-criteria.md",
    "docs/src/overview.md",
    "docs/fixtures/example.png",
    ".plan/done/06-llm-agent/evals/notes.md",
    ".plan/07-ai-service/fixtures/sample.json",
  ]) {
    assert.equal(isDocumentation(file), true, file);
  }
});

test("is not code, configuration or data, whatever its folder", () => {
  for (const file of [
    "apps/api/src/app.ts",
    "apps/web/package.json",
    "pnpm-lock.yaml",
    "turbo.json",
    ".claude/settings.json",
    ".github/workflows/ci.yml",
    "packages/db/seed/demo/person.json",
    "harness/worktree.mjs",
    "docs.ts",
    "apps/api/docs.md.ts",
  ]) {
    assert.equal(isDocumentation(file), false, file);
  }
});

test("is not Markdown that code reads: sources, evals, fixtures and the repository skills", () => {
  for (const file of [
    "apps/mcp-admin/src/prompts/tool.md",
    "packages/memory/evals/datasets/documents/support-handbook-excerpt.md",
    "packages/memory/evals/results/README.md",
    "apps/web/e2e/fixtures/without-profile/README.md",
    "scripts/checks/fixtures/hardcoded-config/accepted/README.md",
    ".claude/skills/update-profile/SKILL.md",
    ".claude/skills/tdd/SKILL.md",
  ]) {
    assert.equal(isDocumentation(file), false, file);
  }
});

test("is not a guide a package's build reads as its readme", () => {
  // The pyproject.toml of packages/llm-agent and packages/api-client-python names AGENTS.md as the
  // readme of the built package, so a change to it changes the package metadata the build produces.
  assert.equal(isDocumentation("packages/llm-agent/AGENTS.md"), false);
  assert.equal(isDocumentation("packages/api-client-python/AGENTS.md"), false);
});
