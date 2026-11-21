// Which changed files are documentation. Documentation never counts as a change of an app or
// package: the developer handoff hook checks no package for it (handoff.mjs), and CI and the
// release plan leave it out before deciding what a change affects
// (scripts/checks/without-documentation.mjs; docs/testing.md, CI). One rule for all of them.

/**
 * Folders whose Markdown code reads, so it is not documentation: sources, evals and their datasets,
 * test fixtures (a seed folder of the website's browser tests exists only through its README) and
 * the repository skills, which MCP Admin's tests and evals give the model.
 */
const READ_BY_CODE = /(^|\/)(src|evals|fixtures)\/|^\.claude\/skills\//;

/**
 * Markdown a package's build reads, so it is not documentation: the guide that
 * packages/llm-agent/pyproject.toml names as the readme of the built package. A test finds every
 * such readme in the repository (scripts/checks/without-documentation.test.mjs).
 */
const READ_BY_BUILD = new Set(["packages/llm-agent/AGENTS.md"]);

/**
 * Whether a changed file (a path relative to the repository root) is documentation: Markdown
 * anywhere, the app and package README.md and AGENTS.md included, and everything in docs/ and
 * .plan/, except Markdown in a folder code reads and Markdown a package's build reads.
 */
export function isDocumentation(file) {
  if (READ_BY_CODE.test(file) || READ_BY_BUILD.has(file)) return false;
  return /^(docs|\.plan)\//.test(file) || /\.md$/i.test(file);
}
