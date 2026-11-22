// Which changed files are documentation. Documentation never counts as a change of an app or
// package: the developer handoff hook checks no package for it (handoff.mjs), and CI and the
// release plan leave it out before deciding what a change affects
// (scripts/checks/without-documentation.mjs; docs/testing.md, CI). One rule for all of them.

/**
 * The two documentation folders of the repository. Everything in them is documentation, whatever
 * a folder inside them is called: docs/evals/ holds the evaluation reports, not the inputs of an
 * eval.
 */
const DOCUMENTATION_FOLDERS = /^(docs|\.plan)\//;

/**
 * Folders whose Markdown code reads, so it is not documentation: sources, evals and their datasets,
 * test fixtures (a seed folder of the website's browser tests exists only through its README) and
 * the repository skills, which MCP Admin's tests and evals give the model. The documentation
 * folders are decided before this rule.
 */
const READ_BY_CODE = /(^|\/)(src|evals|fixtures)\/|^\.claude\/skills\//;

/**
 * Markdown a package's build reads, so it is not documentation: the guide that the pyproject.toml
 * of packages/llm-agent and of packages/api-client-python names as the readme of the built package. A test finds every
 * such readme in the repository (scripts/checks/without-documentation.test.mjs).
 */
const READ_BY_BUILD = new Set([
  "packages/api-client-python/AGENTS.md",
  "packages/llm-agent/AGENTS.md",
]);

/**
 * Whether a changed file (a path relative to the repository root) is documentation: Markdown
 * anywhere, the app and package README.md and AGENTS.md included, and everything in docs/ and
 * .plan/. Outside those two folders, Markdown in a folder code reads and Markdown a package's build
 * reads are not documentation.
 */
export function isDocumentation(file) {
  if (DOCUMENTATION_FOLDERS.test(file)) return true;
  if (READ_BY_CODE.test(file) || READ_BY_BUILD.has(file)) return false;
  return /\.md$/i.test(file);
}
