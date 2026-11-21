// Whether a pull request can change MCP Admin's behaviour, and so runs its paid model evals
// (.github/workflows/model-evals.yml; docs/testing.md, CI). Plain Node, no dependencies.
//
// Usage: node scripts/checks/mcp-admin-evals-affected.mjs <base> [<head>]
// Run from the repository root. Compares <base>...<head> (head defaults to HEAD) and prints
// `mcp-admin=true` or `mcp-admin=false` on stdout, for $GITHUB_OUTPUT; the reasons go to stderr.
// Exits 2 on wrong usage and 1 when Git cannot answer, printing no decision.
//
// MCP Admin reaches the API only through the generated client, so it is affected by:
// - any change under apps/mcp-admin/ (code, tool descriptions, prompts, evals, fixtures,
//   package.json), except its documentation: Markdown outside its src/ and evals/ (AGENTS.md,
//   README.md, docs/), which nothing it runs reads. Markdown in src/ or evals/ counts;
// - a change to a repository skill its evals give the model (`.claude/skills/<name>/`, for each
//   `skill: "<name>"` of its eval sources, read by evals/tests.js);
// - a change, removal or addition of the `mcp-admin` job in the model evals
//   workflow (its other jobs, the `changes` job and this script decide which suites run, not how
//   MCP Admin behaves, so they do not count);
// - a change of a documented route MCP Admin calls in the committed OpenAPI document
//   (packages/api-client/src/generated/openapi.json): any method, parameter, security, request or
//   response of it, with every schema it refers to resolved, a removed route included. The called
//   routes are the `/v1/...` literals of MCP Admin's own sources (src/ and evals/, without tests and
//   their fakes) matched against the documented paths. The contract schemas MCP Admin also checks
//   fields with are the ones the document is exported from (drift-checked in CI), so their changes
//   show here;
// - a code removed from the shared error catalogue (ErrorResponse's `code` list), or any other
//   change to that shape. A code added to it is not: a route that can answer with it documents
//   that among its own responses, which are compared above;
// - a change to the security schemes (the client sends the key by them);
// - a dependency change of apps/mcp-admin or packages/api-client in pnpm-lock.yaml (their
//   `importers` entries, catalog versions included), the client's package.json, or a change to
//   the client's src/index.ts other than its one-line `export type` declarations.
// Anything else, such as a route added for another consumer with its API, services, database and
// contracts, does not run the evals; the API's own tests cover its behaviour, and a manual run of
// the workflow remains for a change the owner wants checked anyway.

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const OPENAPI = "packages/api-client/src/generated/openapi.json";
const CLIENT = "packages/api-client/src/index.ts";
const LOCKFILE = "pnpm-lock.yaml";
const SOURCE_FOLDERS = ["apps/mcp-admin/src", "apps/mcp-admin/evals"];
const SKILLS = ".claude/skills";
const WORKFLOW = ".github/workflows/model-evals.yml";
const WORKFLOW_JOB = "mcp-admin";
const LOCK_IMPORTERS = ["apps/mcp-admin", "packages/api-client"];
const PATH_RULES = [
  {
    test: (file) => file.startsWith("apps/mcp-admin/") && !isDocumentation(file),
    why: "MCP Admin changed",
  },
  {
    test: (file) => file === "packages/api-client/package.json",
    why: "the API client's package changed",
  },
];

const USAGE =
  "Usage: mcp-admin-evals-affected <base> [<head>]\n" +
  "  Prints mcp-admin=true|false: whether <base>...<head> can change MCP Admin's behaviour.\n";

class GitError extends Error {}

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new GitError(`git ${args.join(" ")} failed: ${(result.stderr ?? "").trim()}`);
  }
  return result.stdout;
}

/** A file's content at a commit, or undefined when it does not exist there. */
function show(commit, file) {
  const result = spawnSync("git", ["show", `${commit}:${file}`], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return result.status === 0 ? result.stdout : undefined;
}

/** MCP Admin's documentation: Markdown outside the folders its code and evals read from. */
function isDocumentation(file) {
  return /\.md$/i.test(file) && !SOURCE_FOLDERS.some((folder) => file.startsWith(`${folder}/`));
}

/** The repository skills MCP Admin's evals give the model: each `skill: "<name>"`, sorted. */
export function skillsUsedBy(sources) {
  const skills = new Set();
  for (const { name, text } of sources) {
    if (!isRuntimeSource(name) || !name.startsWith("apps/mcp-admin/evals/")) continue;
    for (const [, skill] of text.matchAll(/\bskill:\s*["']([a-z0-9-]+)["']/g)) skills.add(skill);
  }
  return [...skills].sort();
}

/** A source file MCP Admin runs, not a test or a test's fake. */
function isRuntimeSource(name) {
  return (
    /\.(?:[cm]?js|ts)$/.test(name) &&
    !/\.test\.[cm]?[jt]s$/.test(name) &&
    !/(?:^|\/)test-support\//.test(name) &&
    !/(?:^|\/)fixtures\//.test(name)
  );
}

function templatePattern(route) {
  const escaped = route
    .split(/\{[^}]+\}/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^/]+");
  return new RegExp(`^${escaped}$`);
}

/**
 * The documented routes MCP Admin's runtime sources call: every `/v1/...` literal (a template's
 * `${...}` or a `:param` fills a path parameter) matched against the documented paths. Returns
 * them sorted, with the literals that match none.
 */
export function routesCalledBy(sources, documented) {
  const patterns = documented.map((route) => ({ route, pattern: templatePattern(route) }));
  const called = new Set();
  const unmatched = new Set();
  for (const { name, text } of sources) {
    if (!isRuntimeSource(name)) continue;
    for (const [found] of text.matchAll(/\/v1\/[\w{}$:.*/-]*/g)) {
      const literal = found.replace(/[./]+$/, "");
      const matches = patterns.filter(({ pattern }) => pattern.test(literal));
      for (const { route } of matches) called.add(route);
      if (matches.length === 0) unmatched.add(literal);
    }
  }
  return { called: [...called].sort(), unmatched: [...unmatched].sort() };
}

/** The value a JSON pointer such as `#/components/schemas/Person` names in the document. */
function resolvePointer(document, pointer) {
  if (!pointer.startsWith("#/")) return undefined;
  let value = document;
  for (const part of pointer.slice(2).split("/")) {
    const key = part.replaceAll("~1", "/").replaceAll("~0", "~");
    if (value === null || typeof value !== "object" || !(key in value)) return undefined;
    value = value[key];
  }
  return value;
}

/** A value with every `$ref` replaced by what it names (a cycle stays a reference), keys sorted. */
function resolved(document, value, seen = []) {
  if (Array.isArray(value)) return value.map((item) => resolved(document, item, seen));
  if (value === null || typeof value !== "object") return value;
  if (typeof value.$ref === "string") {
    if (seen.includes(value.$ref)) return { $ref: value.$ref };
    return {
      $resolved: resolved(document, resolvePointer(document, value.$ref) ?? null, [
        ...seen,
        value.$ref,
      ]),
    };
  }
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, resolved(document, value[key], seen)]),
  );
}

/** The shared error catalogue's codes, removed from a copy of the document that is returned. */
function withoutErrorCodes(document) {
  const copy = structuredClone(document ?? {});
  const code = copy.components?.schemas?.ErrorResponse?.properties?.error?.properties?.code;
  const codes = Array.isArray(code?.enum) ? code.enum : [];
  if (code) delete code.enum;
  return { document: copy, codes };
}

function contractReasons(baseText, headText, called) {
  if (baseText === headText) return [];
  let baseDocument;
  let headDocument;
  try {
    baseDocument = baseText === undefined ? {} : JSON.parse(baseText);
    headDocument = headText === undefined ? {} : JSON.parse(headText);
  } catch {
    return [`${OPENAPI} cannot be read as JSON, so its changes cannot be narrowed`];
  }
  const reasons = [];
  const base = withoutErrorCodes(baseDocument);
  const head = withoutErrorCodes(headDocument);
  const removed = base.codes.filter((code) => !head.codes.includes(code));
  if (removed.length > 0) {
    reasons.push(`error codes left the shared catalogue: ${removed.join(", ")}`);
  }
  const shape = (side) =>
    JSON.stringify(
      resolved(side.document, side.document.components?.schemas?.ErrorResponse ?? null),
    );
  if (shape(base) !== shape(head)) reasons.push("the shared error shape (ErrorResponse) changed");
  const schemes = (side) =>
    JSON.stringify(resolved(side.document, side.document.components?.securitySchemes ?? null));
  if (schemes(base) !== schemes(head)) reasons.push("the security schemes changed");
  for (const route of called) {
    const before = JSON.stringify(resolved(base.document, base.document.paths?.[route] ?? null));
    const after = JSON.stringify(resolved(head.document, head.document.paths?.[route] ?? null));
    if (before === after) continue;
    if (after === "null") reasons.push(`route MCP Admin calls was removed: ${route}`);
    else if (before === "null") reasons.push(`route MCP Admin calls was added: ${route}`);
    else reasons.push(`route MCP Admin calls changed: ${route}`);
  }
  return reasons;
}

/** The lines of one importer's entry under `importers:` in a pnpm lockfile. */
function importerEntry(lockfile, importer) {
  const lines = (lockfile ?? "").split("\n");
  const start = lines.indexOf(`  ${importer}:`);
  if (start === -1) return "";
  let end = start + 1;
  while (end < lines.length && !/^ {0,2}\S/.test(lines[end])) end += 1;
  return lines.slice(start, end).join("\n").trimEnd();
}

/**
 * The text of one job of a GitHub Actions workflow: from its key under the top-level `jobs:` to
 * the next job's key, without trailing blank or comment lines (a comment there introduces the
 * next job). Empty when the workflow or the job does not exist. Plain text, so no YAML parser is
 * needed; the workflows of this repository indent jobs by two spaces.
 */
export function workflowJob(workflow, job) {
  const lines = (workflow ?? "").split("\n");
  let index = lines.findIndex((line) => /^jobs:\s*(?:#.*)?$/.test(line));
  if (index === -1) return "";
  const key = new RegExp(`^  ${job.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*(?:#.*)?$`);
  for (index += 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\S/.test(line) && !line.startsWith("#")) return "";
    if (key.test(line)) break;
  }
  if (index >= lines.length) return "";
  const block = [lines[index]];
  for (index += 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^ {0,2}[^\s#]/.test(line)) break;
    block.push(line);
  }
  while (block.length > 1 && /^\s*(?:#.*)?$/.test(block.at(-1))) block.pop();
  return block.join("\n");
}

/** The client's source without its one-line type declarations, which change no behaviour. */
function clientRuntime(text) {
  return (text ?? "")
    .split("\n")
    .filter((line) => !/^export type \w+ = [^;]*;$/.test(line))
    .join("\n");
}

/** The decision for base...head in the current repository. */
export function decide(base, head = "HEAD") {
  const mergeBase = git(["merge-base", base, head]).trim();
  const files = git(["diff", "--name-only", `${mergeBase}...${head}`])
    .split("\n")
    .filter(Boolean);
  let headSources;
  const sources = () =>
    (headSources ??= git(["ls-tree", "-r", "--name-only", head, "--", ...SOURCE_FOLDERS])
      .split("\n")
      .filter((name) => name && isRuntimeSource(name))
      .map((name) => ({ name, text: show(head, name) ?? "" })));
  const reasons = [];
  for (const file of files) {
    const rule = PATH_RULES.find(({ test }) => test(file));
    if (rule) reasons.push(`${rule.why}: ${file}`);
  }
  const skillFiles = files.filter((file) => file.startsWith(`${SKILLS}/`));
  if (skillFiles.length > 0) {
    const used = skillsUsedBy(sources());
    for (const file of skillFiles) {
      if (used.includes(file.slice(SKILLS.length + 1).split("/")[0])) {
        reasons.push(`a skill MCP Admin's evals give the model changed: ${file}`);
      }
    }
  }
  if (files.includes(WORKFLOW)) {
    const before = workflowJob(show(mergeBase, WORKFLOW), WORKFLOW_JOB);
    const after = workflowJob(show(head, WORKFLOW), WORKFLOW_JOB);
    if (before !== after) {
      const what = !after ? "was removed" : !before ? "was added" : "changed";
      reasons.push(`the ${WORKFLOW_JOB} job of ${WORKFLOW} ${what}`);
    }
  }
  if (files.includes(LOCKFILE)) {
    const before = show(mergeBase, LOCKFILE);
    const after = show(head, LOCKFILE);
    for (const importer of LOCK_IMPORTERS) {
      if (importerEntry(before, importer) !== importerEntry(after, importer)) {
        reasons.push(`the dependencies of ${importer} changed in ${LOCKFILE}`);
      }
    }
  }
  if (files.includes(CLIENT)) {
    if (clientRuntime(show(mergeBase, CLIENT)) !== clientRuntime(show(head, CLIENT))) {
      reasons.push(`the API client's runtime changed: ${CLIENT}`);
    }
  }
  if (files.includes(OPENAPI)) {
    const baseText = show(mergeBase, OPENAPI);
    const headText = show(head, OPENAPI);
    const documented = new Set();
    for (const text of [baseText, headText]) {
      try {
        for (const route of Object.keys(JSON.parse(text ?? "{}").paths ?? {}))
          documented.add(route);
      } catch {
        // An unreadable document is reported by contractReasons.
      }
    }
    const { called } = routesCalledBy(sources(), [...documented]);
    reasons.push(...contractReasons(baseText, headText, called));
  }
  return { affected: reasons.length > 0, files, reasons };
}

function main(argv) {
  if (argv.length < 1 || argv.length > 2 || argv.some((argument) => !argument)) {
    process.stderr.write(USAGE);
    return 2;
  }
  let decision;
  try {
    decision = decide(argv[0], argv[1]);
  } catch (error) {
    if (!(error instanceof GitError)) throw error;
    process.stderr.write(`${error.message}\n`);
    return 1;
  }
  if (decision.affected) {
    process.stderr.write("MCP Admin is affected:\n");
    for (const reason of decision.reasons) process.stderr.write(`  ${reason}\n`);
  } else {
    process.stderr.write(
      `MCP Admin is not affected by the ${String(decision.files.length)} changed files.\n`,
    );
  }
  process.stdout.write(`mcp-admin=${String(decision.affected)}\n`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main(process.argv.slice(2));
}
