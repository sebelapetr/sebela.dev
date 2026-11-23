// Whether a pull request can change the Python agent's behaviour, and so runs its paid model
// evals (.github/workflows/model-evals.yml; docs/testing.md, CI; decision 0026, point 8). Plain
// Node, no dependencies.
//
// Usage: node scripts/checks/llm-agent-evals-affected.mjs <base> [<head>]
// Run from the repository root. Compares <base>...<head> (head defaults to HEAD) and prints
// `llm-agent=true` or `llm-agent=false` on stdout, for $GITHUB_OUTPUT; the reasons go to stderr.
// Exits 2 on wrong usage and 1 when Git cannot answer, printing no decision.
//
// The eval runner (packages/llm-agent/evals) loads the agent library and the generated Python
// client and calls the real test API through it, so the evals are affected by:
// - any change under packages/llm-agent/ (code, prompts, evals, datasets and fixtures, package
//   metadata), except its documentation (Markdown outside src/ and evals/) and its tests/, which
//   the runner never loads. Markdown in src/ or evals/ counts;
// - a change to the generated Python client (packages/api-client-python/) other than its
//   documentation and its generated operation and model modules (src/sebela_api_client/api/default/
//   and models/): its runtime, generator configuration and package metadata count. The generated
//   modules follow the committed OpenAPI document, whose operations are compared below;
// - the Python workspace: the root pyproject.toml, uv.lock or .python-version;
// - a change, removal or addition of the `llm-agent` job in the model evals workflow (its other
//   jobs, the `changes` job and this script decide which suites run, not how the agent behaves);
// - a change of a documented operation the agent calls in the committed OpenAPI document
//   (packages/api-client/src/generated/openapi.json): its parameters, security, request or
//   responses, with every schema it refers to resolved, a removed operation included. The called
//   operations are the modules the agent's own sources (src/ and evals/, without tests) import
//   from `sebela_api_client.api.default`, matched to operation IDs (`get_person` is `getPerson`);
// - a code removed from the shared error catalogue (ErrorResponse's `code` list), or any other
//   change to that shape, and a change to the security schemes. A code added to the catalogue is
//   not: an operation that can answer with it documents that among its own responses.
// Anything else does not run the evals. The API's code, services, database and contracts are
// covered by their own tests (their contract changes show through the document above). The
// demo seed does not count because the evals load their own fixture (evals/datasets/fixtures).
// The AI service (apps/ai-service) does not count because the runner never loads it; its own
// tests and its HTTP-specific checks cover it. A manual run of the workflow remains for a change
// the owner wants checked anyway.

import { pathToFileURL } from "node:url";

import {
  GitError,
  git,
  resolved,
  show,
  withoutErrorCodes,
  workflowJob,
} from "./mcp-admin-evals-affected.mjs";

const OPENAPI = "packages/api-client/src/generated/openapi.json";
const AGENT = "packages/llm-agent";
const CLIENT = "packages/api-client-python";
const SOURCE_FOLDERS = [`${AGENT}/src`, `${AGENT}/evals`];
const GENERATED = [
  `${CLIENT}/src/sebela_api_client/api/default/`,
  `${CLIENT}/src/sebela_api_client/models/`,
];
const WORKSPACE = ["pyproject.toml", "uv.lock", ".python-version"];
const WORKFLOW = ".github/workflows/model-evals.yml";
const WORKFLOW_JOB = "llm-agent";
const METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];
const PATH_RULES = [
  {
    test: (file) =>
      file.startsWith(`${AGENT}/`) &&
      !file.startsWith(`${AGENT}/tests/`) &&
      !isAgentDocumentation(file),
    why: "the Python agent changed",
  },
  {
    test: (file) =>
      file.startsWith(`${CLIENT}/`) &&
      !/\.md$/i.test(file) &&
      !GENERATED.some((folder) => file.startsWith(folder)),
    why: "the generated Python client's runtime changed",
  },
  { test: (file) => WORKSPACE.includes(file), why: "the Python workspace changed" },
];

const USAGE =
  "Usage: llm-agent-evals-affected <base> [<head>]\n" +
  "  Prints llm-agent=true|false: whether <base>...<head> can change the Python agent's behaviour.\n";

/** The agent's documentation: Markdown outside the folders its code and evals read from. */
function isAgentDocumentation(file) {
  return /\.md$/i.test(file) && !SOURCE_FOLDERS.some((folder) => file.startsWith(`${folder}/`));
}

/** A Python source the agent or its eval runner loads, not a test. */
function isRuntimeSource(name) {
  return (
    name.endsWith(".py") &&
    SOURCE_FOLDERS.some((folder) => name.startsWith(`${folder}/`)) &&
    !/(?:^|\/)(?:tests?\/|test_[^/]*\.py$|conftest\.py$)/.test(name)
  );
}

/** `getRoadmapAreaDetail` as the generated client names its module: `get_roadmap_area_detail`. */
function moduleName(operationId) {
  return operationId.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

/** Every operation of a document as `method path`, keyed by its generated module name. */
function operationsByModule(document) {
  const operations = new Map();
  for (const [route, item] of Object.entries(document?.paths ?? {})) {
    for (const method of METHODS) {
      const operationId = item?.[method]?.operationId;
      if (typeof operationId === "string") {
        operations.set(moduleName(operationId), `${method} ${route}`);
      }
    }
  }
  return operations;
}

/** The modules imported from `sebela_api_client.api.default` by one Python source. */
function importedModules(text) {
  const modules = new Set();
  const imports = /^\s*from\s+sebela_api_client\.api\.default\s+import\s+(\([^)]*\)|[^\n]+)/gm;
  for (const [, list] of text.matchAll(imports)) {
    for (const entry of list
      .replace(/[()]/g, "")
      .replace(/#[^\n]*/g, "")
      .split(/[,\n]/)) {
      const name = entry
        .trim()
        .split(/\s+as\s+/)[0]
        ?.trim();
      if (name && /^\w+$/.test(name)) modules.add(name);
    }
  }
  const submodules = /^\s*(?:from|import)\s+sebela_api_client\.api\.default\.(\w+)/gm;
  for (const [, name] of text.matchAll(submodules)) modules.add(name);
  return modules;
}

/**
 * The documented operations (`method path`) the agent's runtime sources call through the
 * generated client, sorted, with the imported module names that name no documented operation.
 */
export function operationsCalledBy(sources, ...documents) {
  const operations = new Map();
  for (const document of documents) {
    for (const [name, operation] of operationsByModule(document)) operations.set(name, operation);
  }
  const called = new Set();
  const unmatched = new Set();
  for (const { name, text } of sources) {
    if (!isRuntimeSource(name)) continue;
    for (const module of importedModules(text)) {
      const operation = operations.get(module);
      if (operation) called.add(operation);
      else unmatched.add(module);
    }
  }
  return { called: [...called].sort(), unmatched: [...unmatched].sort() };
}

/** One operation with its path-level parameters, every reference resolved, as text. */
function operationText(document, operation) {
  const [method, route] = operation.split(" ");
  const item = document.paths?.[route];
  if (!item?.[method]) return "null";
  return JSON.stringify(
    resolved(document, { operation: item[method], parameters: item.parameters ?? null }),
  );
}

function contractReasons(baseText, headText, sources) {
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
  const { called } = operationsCalledBy(sources, baseDocument, headDocument);
  for (const operation of called) {
    const before = operationText(base.document, operation);
    const after = operationText(head.document, operation);
    if (before === after) continue;
    if (after === "null") reasons.push(`operation the agent calls was removed: ${operation}`);
    else if (before === "null") reasons.push(`operation the agent calls was added: ${operation}`);
    else reasons.push(`operation the agent calls changed: ${operation}`);
  }
  return reasons;
}

/** The decision for base...head in the current repository. */
export function decide(base, head = "HEAD") {
  const mergeBase = git(["merge-base", base, head]).trim();
  const files = git(["diff", "--name-only", `${mergeBase}...${head}`])
    .split("\n")
    .filter(Boolean);
  const reasons = [];
  for (const file of files) {
    const rule = PATH_RULES.find(({ test }) => test(file));
    if (rule) reasons.push(`${rule.why}: ${file}`);
  }
  if (files.includes(WORKFLOW)) {
    const before = workflowJob(show(mergeBase, WORKFLOW), WORKFLOW_JOB);
    const after = workflowJob(show(head, WORKFLOW), WORKFLOW_JOB);
    if (before !== after) {
      const what = !after ? "was removed" : !before ? "was added" : "changed";
      reasons.push(`the ${WORKFLOW_JOB} job of ${WORKFLOW} ${what}`);
    }
  }
  if (files.includes(OPENAPI)) {
    const sources = git(["ls-tree", "-r", "--name-only", head, "--", ...SOURCE_FOLDERS])
      .split("\n")
      .filter((name) => name && isRuntimeSource(name))
      .map((name) => ({ name, text: show(head, name) ?? "" }));
    reasons.push(...contractReasons(show(mergeBase, OPENAPI), show(head, OPENAPI), sources));
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
    process.stderr.write("The Python agent is affected:\n");
    for (const reason of decision.reasons) process.stderr.write(`  ${reason}\n`);
  } else {
    process.stderr.write(
      `The Python agent is not affected by the ${String(decision.files.length)} changed files.\n`,
    );
  }
  process.stdout.write(`llm-agent=${String(decision.affected)}\n`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main(process.argv.slice(2));
}
