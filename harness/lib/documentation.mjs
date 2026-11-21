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
 * Whether a changed file (a path relative to the repository root) is documentation: Markdown
 * anywhere, the app and package README.md and AGENTS.md included, and everything in docs/ and
 * .plan/, except Markdown in a folder code reads.
 */
export function isDocumentation(file) {
  if (READ_BY_CODE.test(file)) return false;
  return /^(docs|\.plan)\//.test(file) || /\.md$/i.test(file);
}
